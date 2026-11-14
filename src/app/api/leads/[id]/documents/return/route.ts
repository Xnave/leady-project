import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { returnChecklistDocuments } from "@/lib/documents/dossier";
import { closeChecklistReview, leadReplyLang } from "@/lib/documents/review-task";
import { sendStaffReply } from "@/lib/staff-reply";
import { tenantRoleOr403 } from "@/lib/tenant-role";

const Body = z.object({
  groups: z
    .array(z.object({ slotIds: z.array(z.string().min(1)).min(1), note: z.string().trim().min(1).max(500) }))
    .min(1)
    .max(30),
});

/**
 * Advisor sends specific received files back with a note. Works with or without
 * an open review task; an open one is closed as declined.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  const { id: leadId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "empty_reply" }, { status: 400 });
  const conversation = await prisma.conversation.findFirst({
    where: { tenantId, leadId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!conversation) return NextResponse.json({ ok: false, error: "no_open_conversation" }, { status: 400 });
  const lang = await leadReplyLang(tenantId, leadId);
  const result = await returnChecklistDocuments({ tenantId, leadId, groups: parsed.data.groups, lang });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 });
  }
  await sendStaffReply({ tenantId, conversationId: conversation.id, text: result.text, source: "document_return" });
  const actor = await resolveStaffActor();
  await closeChecklistReview({ tenantId, leadId, actorUserId: actor.actorUserId, approved: false, outcome: "returned" });
  return NextResponse.json({ ok: true });
}
