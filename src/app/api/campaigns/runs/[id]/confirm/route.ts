import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { confirmBodySchema, confirmCampaign } from "@/lib/campaigns/manage";
import { campaignRunEvent } from "@/lib/campaigns/run-event";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

/** Owner declaration + schedule. Kicks a run right away when it is due now; the 5-minute tick covers the rest. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const { id } = await params;
  const parsed = confirmBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const res = await confirmCampaign(access.tenantId, id, await resolveStaffActor(), parsed.data);
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  if (new Date(res.scheduledAt).getTime() <= Date.now()) {
    await inngest
      .send(campaignRunEvent(access.tenantId, id, new Date()))
      .catch((err) => console.warn(JSON.stringify({ msg: "campaigns.kick_failed", campaignId: id, error: String(err) })));
  }
  return NextResponse.json(res);
}
