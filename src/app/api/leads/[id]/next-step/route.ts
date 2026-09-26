import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { CrmNotFound, setNextStep } from "@/lib/crm/actions";
import { parseNextStepBody } from "@/lib/crm/input";
import { requireTenantId } from "@/lib/tenant";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const parsed = parseNextStepBody(await req.json().catch(() => null), new Date());
  if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
  try {
    await setNextStep({ tenantId, leadId: id, ...parsed, actor: await resolveStaffActor() });
  } catch (e) {
    if (e instanceof CrmNotFound) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
