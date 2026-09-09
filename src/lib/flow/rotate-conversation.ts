import { prisma } from "@/lib/db";
import type { FlowDefinition } from "@/lib/flow/types";

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Mark a conversation closed at terminal `done` without opening a new empty thread. */
export async function closeConversationAsDone(opts: {
  tenantId: string;
  conversationId: string;
}): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: opts.conversationId, tenantId: opts.tenantId },
    include: { agent: true },
  });
  if (!conversation) return;

  const flow = conversation.agent.flow as FlowDefinition;
  if (conversation.status !== "closed") {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "closed",
        flowState: flow.stages.done?.type === "terminal" ? "done" : conversation.flowState,
      },
    });
  } else if (
    conversation.flowState !== "done" &&
    flow.stages.done?.type === "terminal"
  ) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { flowState: "done" },
    });
  }

  // Drop leftover empty open threads (e.g. from older rotate-on-approve).
  await prisma.conversation.deleteMany({
    where: {
      tenantId: opts.tenantId,
      leadId: conversation.leadId,
      id: { not: conversation.id },
      status: "open",
      messages: { none: {} },
    },
  });
}

/**
 * Close the current open conversation for a lead and open a fresh one at flow start.
 * Used for idle, admin "new conversation", and HITL resume (needs an open thread).
 */
export async function rotateConversation(opts: {
  tenantId: string;
  leadId: string;
  reason: string;
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
    },
  });

  return { previousId: current?.id ?? null, conversationId: created.id };
}
