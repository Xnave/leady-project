import { NextResponse } from "next/server";
import { actOnCampaign } from "@/lib/campaigns/manage";
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
  return NextResponse.json(res);
}
