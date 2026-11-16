import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { actOnCampaign } from "@/lib/campaigns/manage";
import { campaignRunEvent } from "@/lib/campaigns/run-event";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action === "pause" || body.action === "resume" || body.action === "cancel" ? body.action : null;
  if (!action) return NextResponse.json({ error: "bad_transition" }, { status: 400 });
  const res = await actOnCampaign(access.tenantId, id, action);
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  if (action === "resume" && (!res.scheduledAt || new Date(res.scheduledAt).getTime() <= Date.now())) {
    await inngest
      .send(campaignRunEvent(access.tenantId, id, new Date()))
      .catch((err) => console.warn(JSON.stringify({ msg: "campaigns.kick_failed", campaignId: id, error: String(err) })));
  }
  return NextResponse.json(res);
}
