import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { closeChecklistReview } from "@/lib/documents/review-task";
import { tenantRoleOr403 } from "@/lib/tenant-role";

/**
 * Advisor approves a finished wave. Closes the review task and sends nothing:
 * opening the next wave is its own action, after something happened outside the app.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { id: leadId } = await params;
  const actor = await resolveStaffActor();
  const closed = await closeChecklistReview({
    tenantId: access.tenantId,
    leadId,
    actorUserId: actor.actorUserId,
    approved: true,
    outcome: "approved",
  });
  if (!closed) return NextResponse.json({ ok: false, error: "no_open_review" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
