import { NextResponse } from "next/server";
import { isInviteRole } from "@/lib/org-roles";
import { inviteTeamMember, requireTeamManager } from "@/lib/team";

export async function POST(req: Request) {
  try {
    const actor = await requireTeamManager();
    const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
    const email = String(body.email ?? "").trim();
    const role = body.role;
    if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });
    if (!isInviteRole(role)) return NextResponse.json({ error: "Role must be admin or member" }, { status: 400 });
    await inviteTeamMember(actor, email, role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed";
    const status = message === "Forbidden" || message.includes("impersonat") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
