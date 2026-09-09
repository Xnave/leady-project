import { NextResponse } from "next/server";
import { rotateConversation } from "@/lib/conversations";
import { requireTenantId } from "@/lib/tenant";
import { redirectPath } from "@/lib/request-url";
import { prisma } from "@/lib/db";

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
  const rotated = await rotateConversation({
    tenantId,
    leadId,
    reason: "admin",
  });
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json(rotated);
  }
  return NextResponse.redirect(redirectPath(req, `/leads/${leadId}?c=${rotated.conversationId}`), 303);
}
