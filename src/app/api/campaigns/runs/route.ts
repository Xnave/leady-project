import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { createCampaign, listCampaigns } from "@/lib/campaigns/manage";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

export async function GET() {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  return NextResponse.json({ campaigns: await listCampaigns(access.tenantId) });
}

export async function POST(req: Request) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const body = await req.json().catch(() => ({}));
  const res = await createCampaign(access.tenantId, await resolveStaffActor(), body);
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  return NextResponse.json(res);
}
