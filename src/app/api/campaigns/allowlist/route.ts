import { NextResponse } from "next/server";
import { allowAudiencePhone } from "@/lib/campaigns/manage";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

/** Add one audience member's phone to this tenant's test list. */
export async function POST(req: Request) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const body = (await req.json().catch(() => ({}))) as { contactId?: unknown; leadId?: unknown };
  const res = await allowAudiencePhone(access.tenantId, {
    contactId: typeof body.contactId === "string" ? body.contactId : null,
    leadId: typeof body.leadId === "string" ? body.leadId : null,
  });
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  return NextResponse.json(res);
}
