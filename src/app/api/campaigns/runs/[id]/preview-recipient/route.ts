import { NextResponse } from "next/server";
import { previewRecipient } from "@/lib/campaigns/manage";
import { campaignAccessOr403, errorStatus } from "@/lib/campaigns/route-gate";

/** The template filled for one audience member. Returns the text, not their record. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await campaignAccessOr403();
  if (access instanceof Response) return access;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { contactId?: unknown; leadId?: unknown; params?: unknown };
  const res = await previewRecipient(
    access.tenantId,
    id,
    {
      contactId: typeof body.contactId === "string" ? body.contactId : null,
      leadId: typeof body.leadId === "string" ? body.leadId : null,
    },
    Array.isArray(body.params) ? body.params : undefined,
  );
  if ("error" in res) return NextResponse.json(res, { status: errorStatus(res.error) });
  return NextResponse.json(res);
}
