import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { CrmNotFound, setManualStage } from "@/lib/crm/actions";
import { parseStageBody } from "@/lib/crm/input";
import { requireTenantId } from "@/lib/tenant";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const parsed = parseStageBody(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
  try {
    await setManualStage({ tenantId, leadId: id, ...parsed, actor: await resolveStaffActor() });
  } catch (e) {
    if (e instanceof CrmNotFound) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
