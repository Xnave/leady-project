import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { campaignInputSchema, createCampaign, listCampaigns } from "@/lib/campaigns/manage";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

export async function GET() {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  return NextResponse.json({ campaigns: await listCampaigns(access.tenantId) });
}

export async function POST(req: Request) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const parsed = campaignInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const res = await createCampaign(access.tenantId, await resolveStaffActor(), parsed.data);
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  return NextResponse.json(res);
}
