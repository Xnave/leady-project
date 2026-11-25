import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { closeInviteTasks } from "@/lib/documents/review-task";
import { tenantRoleOr403 } from "@/lib/tenant-role";

/**
 * Advisor marks an auto-invite task (client didn't start, or the send result is
 * unknown) as handled, after contacting the client themselves. Sends nothing.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { id: leadId } = await params;
  const actor = await resolveStaffActor();
  const closed = await closeInviteTasks({ tenantId: access.tenantId, leadId, actorUserId: actor.actorUserId });
  if (!closed) return NextResponse.json({ ok: false, error: "no_open_invite_task" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
