import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { actionBodySchema, actOnCampaign } from "@/lib/campaigns/manage";
import { campaignRunEvent } from "@/lib/campaigns/run-event";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const { id } = await params;
  const parsed = actionBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const action = parsed.data.action;
  const res = await actOnCampaign(access.tenantId, id, action);
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  if (action === "resume" && (!res.scheduledAt || new Date(res.scheduledAt).getTime() <= Date.now())) {
    await inngest
      .send(campaignRunEvent(access.tenantId, id, new Date()))
      .catch((err) => console.warn(JSON.stringify({ msg: "campaigns.kick_failed", campaignId: id, error: String(err) })));
  }
  return NextResponse.json(res);
}
