import { NextResponse } from "next/server";
import { isInviteRole } from "@/lib/org-roles";
import { removeMember, requireTeamManager, updateMemberRole } from "@/lib/team";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireTeamManager();
    const { userId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { role?: string };
    if (!isInviteRole(body.role)) {
      return NextResponse.json({ error: "Role must be admin or member" }, { status: 400 });
    }
    await updateMemberRole(actor, userId, body.role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed";
    const status = message === "Forbidden" || message.includes("impersonat") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  try {
    const actor = await requireTeamManager();
    const { userId } = await ctx.params;
    await removeMember(actor, userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed";
    const status = message === "Forbidden" || message.includes("impersonat") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
