import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { requestDocuments } from "@/lib/documents/dossier";
import { closeChecklistReview, leadReplyLang } from "@/lib/documents/review-task";
import { tenantRoleOr403 } from "@/lib/tenant-role";

const Body = z.object({
  docTypes: z.array(z.string().min(1).max(80)).min(1).max(20),
  note: z.string().max(500).default(""),
});

/** Advisor asks the lead for specific documents from the tenant's catalog. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  const { id: leadId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  const lang = await leadReplyLang(tenantId, leadId);
  const result = await requestDocuments({ tenantId, leadId, ...parsed.data, lang });
  if (!result.ok) return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 });
  // Asking for more replaces the pending review: it opens again when the new files arrive.
  const actor = await resolveStaffActor();
  await closeChecklistReview({ tenantId, leadId, actorUserId: actor.actorUserId, approved: false, outcome: "requested" });
  return NextResponse.json({ ok: true });
}
