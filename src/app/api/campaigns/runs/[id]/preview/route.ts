import { NextResponse } from "next/server";
import { previewFor } from "@/lib/campaigns/manage";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

/** Recipients after skips, sample names and estimated cost. Writes nothing. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const { id } = await params;
  const res = await previewFor(access.tenantId, id);
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  return NextResponse.json(res);
}
