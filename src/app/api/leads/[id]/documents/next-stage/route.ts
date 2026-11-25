import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { releaseNextDocumentStage } from "@/lib/documents/dossier";
import { CHECKLIST_REVIEW_REASON, leadReplyLang } from "@/lib/documents/review-task";
import { tenantRoleOr403 } from "@/lib/tenant-role";

/**
 * Advisor action: tell the lead the next document stage is starting. Does not add document types.
 * Never automatic, and only after the finished wave was reviewed: something has to happen
 * outside the app before the next documents make sense.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  const { id: leadId } = await params;
  const review = await prisma.hitlTask.findFirst({
    where: { tenantId, leadId, reason: CHECKLIST_REVIEW_REASON, status: "open" },
    select: { id: true },
  });
  if (review) return NextResponse.json({ ok: false, error: "review_open" }, { status: 409 });
  const lang = await leadReplyLang(tenantId, leadId);
  const result = await releaseNextDocumentStage(tenantId, leadId, lang);
  if (!result.ok) return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 });
  return NextResponse.json(result);
}
