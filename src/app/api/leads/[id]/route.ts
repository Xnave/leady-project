import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { CrmNotFound, setManualStage } from "@/lib/crm/actions";
import { isPipelineStage, type PipelineStage } from "@/lib/crm/types";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { isDemoLead } from "@/lib/leads";

// Legacy statuses from the old LeadStatusSelect UI, mapped onto pipeline stages.
const LEGACY_STATUS_TO_STAGE: Record<string, PipelineStage> = {
  new: "new",
  open: "talking",
  in_progress: "qualified",
  won: "won",
  lost: "lost",
  closed: "lost",
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const stage = body.status
    ? (LEGACY_STATUS_TO_STAGE[body.status] ?? (isPipelineStage(body.status) ? body.status : undefined))
    : undefined;
  if (!stage) {
    return NextResponse.json({ error: "Bad status" }, { status: 400 });
  }
  try {
    await setManualStage({
      tenantId,
      leadId: id,
      stage,
      reason: "",
      actor: await resolveStaffActor(),
    });
  } catch (e) {
    if (e instanceof CrmNotFound) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true, status: body.status });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const lead = await prisma.lead.findFirst({ where: { id, tenantId } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isDemoLead(lead.externalUserId)) {
    return NextResponse.json({ error: "Only demo leads can be deleted" }, { status: 403 });
  }
  await prisma.lead.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
