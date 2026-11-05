import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { confirmCampaign } from "@/lib/campaigns/manage";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

/** Owner declaration + schedule. Kicks a run right away when it is due now; the 5-minute tick covers the rest. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const res = await confirmCampaign(access.tenantId, id, await resolveStaffActor(), body);
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  if (new Date(res.scheduledAt).getTime() <= Date.now()) {
    await inngest
      .send({ name: "campaigns/run.requested", data: { tenantId: access.tenantId, campaignId: id } })
      .catch((err) => console.warn(JSON.stringify({ msg: "campaigns.kick_failed", campaignId: id, error: String(err) })));
  }
  return NextResponse.json(res);
}
