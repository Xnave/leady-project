import { prisma } from "@/lib/db";
import type { FlowDefinition, LeadFields } from "@/lib/flow/types";
import { clearBookingSessionFields } from "@/lib/flow/booking";
import { clearReservationSessionFields } from "@/lib/flow/reservation-collect";
import { parseReservationConfig } from "@/lib/flow/reservation-config";
import { loadInstanceConfig } from "@/lib/capability-instances";
import { Prisma } from "@prisma/client";

async function reservationConfigForTenant(tenantId: string) {
  return parseReservationConfig(
    await loadInstanceConfig({ tenantId, capabilityId: "reservations" }),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type LifecycleReason =
  | "idle"
  | "admin"
  | "done"
  | "hitl_resume"
  | "approve"
  | "inbound_create"
  | "inbound_reopen"
  | "hitl_completed"
  | "admin_reopen"
  | "start_new_conversation"
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

export type InboundThreadDecision = "use_open" | "reopen" | "create";

/**
 * Deterministic inbound routing: keep an open thread, reopen a recent/relevant
 * closed one, or start fresh. No LLM involved.
 */
export function decideInboundThread(opts: {
  forceFresh: boolean;
  hasOpenConversation: boolean;
  /** Newest message on the latest closed thread; null = no closed thread. */
  closedLastMessageAt: Date | null;
  idleResetDays: number;
  hasRelevantRequest: boolean;
  now?: Date;
}): InboundThreadDecision {
  if (opts.forceFresh) return "create";
  if (opts.hasOpenConversation) return "use_open";
  if (!opts.closedLastMessageAt) return "create";
  if (opts.hasRelevantRequest) return "reopen";
  return conversationIdleExpired({
    lastMessageAt: opts.closedLastMessageAt,
    idleResetDays: opts.idleResetDays,
    now: opts.now,
  })
    ? "create"
    : "reopen";
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
  const reservationConfig = await reservationConfigForTenant(opts.tenantId);
  const nextFields = clearReservationSessionFields(
    clearBookingSessionFields(prevFields),
    reservationConfig,
  );
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
 * Reopen a closed conversation (same thread). Used by staff and by inbound
 * routing after approve / short silence. Refuses if another open thread exists.
 */
export async function reopenConversation(opts: {
  tenantId: string;
  conversationId: string;
  reason?: LifecycleReason;
}): Promise<{ conversationId: string }> {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: opts.conversationId, tenantId: opts.tenantId },
    include: { agent: true },
  });

  const openOther = await prisma.conversation.findFirst({
    where: {
      tenantId: opts.tenantId,
      leadId: conversation.leadId,
      status: { not: "closed" },
      id: { not: conversation.id },
    },
    select: { id: true },
  });
  if (openOther) {
    throw new Error("open_conversation_exists");
  }

  if (conversation.status === "closed") {
    const flow = conversation.agent.flow as FlowDefinition;
    const resumeStage =
      flow.stages.talk?.type === "talk"
        ? "talk"
        : flow.restartPolicy.fallbackStage && flow.stages[flow.restartPolicy.fallbackStage]
          ? flow.restartPolicy.fallbackStage
          : flow.start;
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "open",
        flowState: resumeStage,
        lifecycleReason: opts.reason ?? "admin_reopen",
      },
    });
  }

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
 * Refuses to create a second open thread if one already exists (unless closing it first).
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

  // Admin "start" while another open exists (and we're not closing that open one) → refuse.
  if (opts.reason === "admin" && !opts.conversationId) {
    const open = await prisma.conversation.findFirst({
      where: { tenantId: opts.tenantId, leadId: opts.leadId, status: { not: "closed" } },
      select: { id: true },
    });
    if (open) {
      return { previousId: null, conversationId: open.id };
    }
  }

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
  } else if (opts.reason === "admin") {
    // Starting a brand-new thread: must not leave a parallel open conversation.
    const open = await prisma.conversation.findFirst({
      where: { tenantId: opts.tenantId, leadId: opts.leadId, status: { not: "closed" } },
      select: { id: true },
    });
    if (open) {
      throw new Error("open_conversation_exists");
    }
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
  const reservationConfig = await reservationConfigForTenant(opts.tenantId);
  const nextFields = clearReservationSessionFields(
    clearBookingSessionFields(prevFields),
    reservationConfig,
  );
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
