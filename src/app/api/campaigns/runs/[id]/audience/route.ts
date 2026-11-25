import { NextResponse } from "next/server";
import { audiencePage } from "@/lib/campaigns/manage";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

/** One page of the campaign audience. `reason=not_allowlisted` is the test-list picker. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const { id } = await params;
  const url = new URL(req.url);
  const reason = url.searchParams.get("reason") === "not_allowlisted" ? "not_allowlisted" : null;
  const res = await audiencePage(access.tenantId, id, { cursor: url.searchParams.get("cursor") ?? "", reason });
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  return NextResponse.json(res);
}
