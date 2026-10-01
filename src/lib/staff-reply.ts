import { loadTurnContext } from "@/lib/conversations";
import { prisma } from "@/lib/db";

/**
 * A teammate's message to the customer (role `human`, never as the customer): saved on
 * the thread and sent on the lead's channel. Shared by the chat composer and by
 * answering a handoff directly.
 */
export async function sendStaffReply(opts: {
  tenantId: string;
  conversationId: string;
  text: string;
  source: string;
}): Promise<void> {
  await prisma.message.create({
    data: {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      role: "human",
      text: opts.text,
      providerMessageId: `staff-${crypto.randomUUID()}`,
      metadata: { source: opts.source },
    },
  });

  // Reuse the channel send path without inserting a second (agent) message.
  const ctx = await loadTurnContext(opts.tenantId, opts.conversationId);
  const { sendOnChannel } = await import("@/lib/channels/meta");
  await sendOnChannel({
    apiBase: ctx.connection.apiBase,
    accessToken: ctx.connection.accessToken,
    provider: ctx.connection.provider,
    providerAccountId: ctx.connection.providerAccountId,
    to: ctx.lead.externalUserId,
    text: opts.text,
    zernioAccountId: ctx.connection.zernioAccountId,
    zernioConversationId:
      typeof ctx.lead.fields.zernioConversationId === "string"
        ? ctx.lead.fields.zernioConversationId
        : undefined,
  });
}
