import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { setBotPaused } from "@/lib/human-reply";
import { requireTenantId } from "@/lib/tenant";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const body = (await req.json().catch(() => ({}))) as { paused?: boolean };
  const lead = await prisma.lead.findFirst({ where: { id, tenantId } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await setBotPaused({ tenantId, leadId: id, paused: Boolean(body.paused) });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: result.status });
}
