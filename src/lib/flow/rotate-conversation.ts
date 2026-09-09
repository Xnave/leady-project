import { prisma } from "@/lib/db";
import type { FlowDefinition, LeadFields } from "@/lib/flow/types";
import { clearBookingSessionFields } from "@/lib/flow/booking";
import { Prisma } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

export type LifecycleReason =
  | "idle"
  | "admin"
  | "done"
  | "hitl_resume"
  | "approve"
  | "inbound_create"
  | "hitl_completed"
  | string;

export function conversationIdleExpired(opts: {
  lastMessageAt: Date | null | undefined;
  idleResetDays: number;
  now?: Date;
}): boolean {
  const days = opts.idleResetDays;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return false;
  if (!opts.lastMessageAt) return false;
  const now = opts.now ?? new Date();
  return now.getTime() - opts.lastMessageAt.getTime() >= days * DAY_MS;
}

async function sweepEmptyOpenThreads(opts: {
  tenantId: string;
  leadId: string;
  keepConversationId: string;
}): Promise<void> {
  await prisma.conversation.deleteMany({
    where: {
      tenantId: opts.tenantId,
      leadId: opts.leadId,
      id: { not: opts.keepConversationId },
      status: "open",
      messages: { none: {} },
    },
  });
}

/** Mark a conversation closed at terminal `done` without opening a new empty thread. */
export async function closeConversationAsDone(opts: {
  tenantId: string;
  conversationId: string;
  reason?: LifecycleReason;
}): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: opts.conversationId, tenantId: opts.tenantId },
    include: { agent: true, lead: true },
  });
  if (!conversation) return;

  const flow = conversation.agent.flow as FlowDefinition;
  const lifecycleReason = opts.reason ?? "done";
  const doneState = flow.stages.done?.type === "terminal" ? "done" : conversation.flowState;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      status: "closed",
      flowState: doneState,
      lifecycleReason,
      // Primary fix: session dies with the thread; next inbound gets empty {}.
      session: {} as Prisma.InputJsonValue,
    },
  });

  // Compat: strip any leaked booking-session keys still parked on Lead.fields.
  const prevFields = (conversation.lead.fields as LeadFields) ?? {};
  const nextFields = clearBookingSessionFields(prevFields);
  if (JSON.stringify(prevFields) !== JSON.stringify(nextFields)) {
    await prisma.lead.update({
      where: { id: conversation.leadId },
      data: { fields: nextFields as Prisma.InputJsonValue },
    });
  }

  await sweepEmptyOpenThreads({
    tenantId: opts.tenantId,
    leadId: conversation.leadId,
    keepConversationId: conversation.id,
  });
}

/**
 * Resume the same conversation after a non-booking HITL task — no new thread.
 */
export async function resumeConversationAfterHitl(opts: {
  tenantId: string;
  conversationId: string;
}): Promise<{ conversationId: string }> {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: opts.conversationId, tenantId: opts.tenantId },
    include: { agent: true },
  });
  const flow = conversation.agent.flow as FlowDefinition;
  const resumeStage =
    flow.restartPolicy.fallbackStage && flow.stages[flow.restartPolicy.fallbackStage]
      ? flow.restartPolicy.fallbackStage
      : flow.start;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      status: "open",
      flowState: resumeStage,
      lifecycleReason: "hitl_resume",
    },
  });

  await sweepEmptyOpenThreads({
    tenantId: opts.tenantId,
    leadId: conversation.leadId,
    keepConversationId: conversation.id,
  });

  return { conversationId: conversation.id };
}

/**
 * Close the current open conversation for a lead and open a fresh one at flow start.
 * Only for idle, admin "new conversation", or explicit start_new_conversation.
 */
export async function rotateConversation(opts: {
  tenantId: string;
  leadId: string;
  reason: LifecycleReason;
  conversationId?: string;
}): Promise<{ previousId: string | null; conversationId: string }> {
  const lead = await prisma.lead.findFirstOrThrow({
    where: { id: opts.leadId, tenantId: opts.tenantId },
    include: {
      channel: { include: { agent: true } },
      conversations: {
        where: opts.conversationId
          ? { id: opts.conversationId }
          : { status: { not: "closed" } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const agent = lead.channel.agent;
  const flow = agent.flow as FlowDefinition;
  const current = lead.conversations[0];

  if (current && current.status !== "closed") {
    await prisma.conversation.update({
      where: { id: current.id },
      data: {
        status: "closed",
        flowState:
          flow.stages.done?.type === "terminal" ? "done" : current.flowState,
        lifecycleReason: opts.reason,
        session: {} as Prisma.InputJsonValue,
      },
    });
  }

  const created = await prisma.conversation.create({
    data: {
      tenantId: opts.tenantId,
      leadId: opts.leadId,
      channelId: lead.channelId,
      agentId: agent.id,
      status: "open",
      flowState: flow.start,
      flowVersion: agent.flowVersion,
      summary: "",
      lifecycleReason: opts.reason,
      session: {} as Prisma.InputJsonValue,
    },
  });

  // Compat: strip leaked booking-session keys from Lead (new thread already has empty session).
  const prevFields = (lead.fields as LeadFields) ?? {};
  const nextFields = clearBookingSessionFields(prevFields);
  const fieldsChanged = JSON.stringify(prevFields) !== JSON.stringify(nextFields);
  const markUnread = opts.reason === "idle";
  if (fieldsChanged || markUnread) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(fieldsChanged ? { fields: nextFields as Prisma.InputJsonValue } : {}),
        ...(markUnread ? { adminUnread: true } : {}),
      },
    });
  }

  return { previousId: current?.id ?? null, conversationId: created.id };
}
