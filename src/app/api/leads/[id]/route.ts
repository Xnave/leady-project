import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { isDemoLead } from "@/lib/leads";

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
