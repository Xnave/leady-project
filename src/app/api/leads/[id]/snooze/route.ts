import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { CrmNotFound, snoozeLead } from "@/lib/crm/actions";
import { parseSnoozeBody } from "@/lib/crm/input";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const body = await req.json().catch(() => null);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  const parsed = parseSnoozeBody(body, new Date(), tenant?.timezone ?? "Asia/Jerusalem");
  if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
  try {
    const ok = await snoozeLead({ tenantId, leadId: id, ...parsed, actor: await resolveStaffActor() });
    if (!ok) return NextResponse.json({ error: "not_snoozable" }, { status: 409 });
  } catch (e) {
    if (e instanceof CrmNotFound) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
