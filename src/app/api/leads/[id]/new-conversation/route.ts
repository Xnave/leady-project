import { NextResponse } from "next/server";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";
import { prisma } from "@/lib/db";

/** End (close) the active conversation — does not open an empty new thread. */
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
  const conversationId =
    String(form?.get("conversationId") ?? "").trim() ||
    (
      await prisma.conversation.findFirst({
        where: { leadId, tenantId, status: { not: "closed" } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    )?.id;

  if (conversationId) {
    await closeConversationAsDone({
      tenantId,
      conversationId,
      reason: "admin",
    });
  }

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ conversationId: conversationId ?? null });
  }
  return NextResponse.redirect(redirectPath(req, `/leads/${leadId}`), 303);
}
