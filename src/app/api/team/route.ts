import { NextResponse } from "next/server";
import { listTeam, requireTeamManager, maybeBackfillOwnerClerkUserId } from "@/lib/team";

export async function GET() {
  try {
    const actor = await requireTeamManager();
    await maybeBackfillOwnerClerkUserId(actor.tenantId, actor.userId, actor.email);
    const data = await listTeam(actor);
    return NextResponse.json({ ...data, actorRole: actor.role });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Forbidden";
    const status = message === "Forbidden" || message.includes("impersonat") ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
