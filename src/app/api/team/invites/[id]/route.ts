import { NextResponse } from "next/server";
import { requireTeamManager, revokeInvite } from "@/lib/team";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireTeamManager();
    const { id } = await ctx.params;
    await revokeInvite(actor, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed";
    const status = message === "Forbidden" || message.includes("impersonat") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
