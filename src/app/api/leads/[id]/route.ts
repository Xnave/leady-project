import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { CrmNotFound, setManualStage } from "@/lib/crm/actions";
import { isPipelineStage, type PipelineStage } from "@/lib/crm/types";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { isDemoLead } from "@/lib/leads";
import { normalizeLeadStatus } from "@/lib/ui";

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
  const status = typeof body.status === "string" ? body.status : "";
  // Own keys only: `in` / plain indexing would match prototype keys like "constructor".
  const isLegacyStatus = Object.hasOwn(LEGACY_STATUS_TO_STAGE, status);
  const stage = isLegacyStatus
    ? LEGACY_STATUS_TO_STAGE[status]
    : isPipelineStage(status)
      ? status
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
    // Dual-write for the legacy (flag-off) list, which still reads/filters on Lead.status.
    // Only for legacy status values — raw pipeline ids passed directly don't map to a status.
    if (isLegacyStatus) {
      await prisma.lead.updateMany({
        where: { id, tenantId },
        data: { status: normalizeLeadStatus(status) },
      });
    }
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
