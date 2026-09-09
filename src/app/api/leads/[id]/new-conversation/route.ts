import { NextResponse } from "next/server";
import {
  closeConversationAsDone,
  rotateConversation,
} from "@/lib/flow/rotate-conversation";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";
import { prisma } from "@/lib/db";

/**
 * intent=end (default): close the active conversation.
 * intent=start: open a fresh conversation (after end, or when already closed).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;
  const tenantId = await requireTenantId();
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const form = await req.formData().catch(() => null);
  const intent = String(form?.get("intent") ?? "end").trim() === "start" ? "start" : "end";
  const conversationId =
    String(form?.get("conversationId") ?? "").trim() ||
    (
      await prisma.conversation.findFirst({
        where: { leadId, tenantId, status: { not: "closed" } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    )?.id;

  let redirectConvoId = conversationId ?? null;

  if (intent === "end") {
    if (conversationId) {
      await closeConversationAsDone({
        tenantId,
        conversationId,
        reason: "admin",
      });
    }
  } else {
    const rotated = await rotateConversation({
      tenantId,
      leadId,
      reason: "admin",
      conversationId: conversationId || undefined,
    });
    redirectConvoId = rotated.conversationId;
  }

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ conversationId: redirectConvoId });
  }
  const path = redirectConvoId
    ? `/leads/${leadId}?c=${redirectConvoId}`
    : `/leads/${leadId}`;
  return NextResponse.redirect(redirectPath(req, path), 303);
}
