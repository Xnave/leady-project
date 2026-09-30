import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendStaffReply } from "@/lib/staff-reply";
import { requireTenantId } from "@/lib/tenant";
import { safeRefreshLeadState } from "@/lib/crm/refresh";

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

  await sendStaffReply({ tenantId, conversationId: conversation.id, text, source: "lead_workspace" });

  await prisma.lead.update({
    where: { id: leadId },
    data: { adminUnread: false },
  });
  await safeRefreshLeadState(tenantId, leadId);

  return NextResponse.json({ ok: true, conversationId: conversation.id });
}
