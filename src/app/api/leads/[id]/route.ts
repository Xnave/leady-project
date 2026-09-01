import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { isDemoLead } from "@/lib/leads";
import { LEAD_STATUSES, normalizeLeadStatus } from "@/lib/ui";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const status = normalizeLeadStatus(body.status);
  if (!LEAD_STATUSES.includes(status) && body.status !== "closed") {
    return NextResponse.json({ error: "Bad status" }, { status: 400 });
  }
  const lead = await prisma.lead.findFirst({ where: { id, tenantId } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.lead.update({ where: { id }, data: { status } });
  return NextResponse.json({ ok: true, status });
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
