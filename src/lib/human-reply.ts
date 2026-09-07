import { Prisma } from "@prisma/client";
import { sendOnChannel } from "@/lib/channels/meta";
import { loadTurnContext } from "@/lib/conversations";
import { prisma } from "@/lib/db";

export type TakeoverError = "no_conversation" | "empty";

/**
 * The owner speaking to the customer as themselves — not the bot, and not the
 * simulator (which fakes an *inbound* message and lets the agent answer).
 * Saved with role "human" so the transcript shows who actually replied, and so
 * the interpreter treats it as prior context rather than an agent turn.
 */
export async function sendHumanReply(opts: {
  tenantId: string;
  leadId: string;
  text: string;
}): Promise<{ conversationId: string } | { error: TakeoverError }> {
  const text = opts.text.trim();
  if (!text) return { error: "empty" };

  const conversation = await prisma.conversation.findFirst({
    where: { tenantId: opts.tenantId, leadId: opts.leadId },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) return { error: "no_conversation" };

  const ctx = await loadTurnContext(opts.tenantId, conversation.id);
  await prisma.message.create({
    data: {
      tenantId: opts.tenantId,
      conversationId: conversation.id,
      role: "human",
      text,
      providerMessageId: `human-${crypto.randomUUID()}`,
      metadata: { source: "takeover" } as Prisma.InputJsonValue,
    },
  });
  await sendOnChannel({
    apiBase: ctx.connection.apiBase,
    accessToken: ctx.connection.accessToken,
    provider: ctx.connection.provider,
    providerAccountId: ctx.connection.providerAccountId,
    to: ctx.lead.externalUserId,
    text,
    zernioAccountId: ctx.connection.zernioAccountId,
    zernioConversationId:
      typeof ctx.lead.fields.zernioConversationId === "string"
        ? ctx.lead.fields.zernioConversationId
        : undefined,
  });
  // Touch the conversation so the leads list sorts by real activity.
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });
  return { conversationId: conversation.id };
}

/**
 * Owner-controlled mute. `waiting_human` is the same state the interpreter uses
 * when the flow escalates, so a muted conversation persists inbound messages and
 * answers nothing until the owner hands it back.
 */
export async function setBotPaused(opts: {
  tenantId: string;
  leadId: string;
  paused: boolean;
}): Promise<{ status: string } | { error: TakeoverError }> {
  const conversation = await prisma.conversation.findFirst({
    where: { tenantId: opts.tenantId, leadId: opts.leadId },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) return { error: "no_conversation" };
  if (conversation.status === "closed") return { status: "closed" };

  const status = opts.paused ? "waiting_human" : "open";
  await prisma.$transaction([
    prisma.conversation.update({ where: { id: conversation.id }, data: { status } }),
    // Handing the conversation back to the bot resolves whatever escalation put
    // it on hold, so the Inbox badge does not keep counting a task the owner
    // already dealt with in the chat.
    ...(opts.paused
      ? []
      : [
          prisma.hitlTask.updateMany({
            where: { tenantId: opts.tenantId, conversationId: conversation.id, status: "open" },
            data: { status: "done", completedBy: "owner", completedAt: new Date() },
          }),
        ]),
  ]);
  return { status };
}
