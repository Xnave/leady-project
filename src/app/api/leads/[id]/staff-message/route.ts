import { NextResponse } from "next/server";
import { loadTurnContext } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

/** Staff reply on a lead conversation (role=human), never as the customer. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;
  const tenantId = await requireTenantId();
  const body = (await req.json()) as { conversationId?: string; text?: string };
  const text = body.text?.trim() ?? "";
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      conversations: {
        where: body.conversationId
          ? { id: body.conversationId }
          : { status: { not: "closed" } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  const conversation = lead.conversations[0];
  if (!conversation) {
    return NextResponse.json({ error: "no_open_conversation" }, { status: 400 });
  }
  if (conversation.status === "closed") {
    return NextResponse.json({ error: "conversation_closed" }, { status: 400 });
  }

  await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      role: "human",
      text,
      providerMessageId: `staff-${crypto.randomUUID()}`,
      metadata: { source: "lead_workspace" },
    },
  });

  // Reuse channel send path without duplicating DB insert as agent.
  const ctx = await loadTurnContext(tenantId, conversation.id);
  const { sendOnChannel } = await import("@/lib/channels/meta");
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

  await prisma.lead.update({
    where: { id: leadId },
    data: { adminUnread: false },
  });

  return NextResponse.json({ ok: true, conversationId: conversation.id });
}
