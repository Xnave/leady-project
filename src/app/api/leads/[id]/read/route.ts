import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const body = (await req.json()) as { unread?: boolean };
  const unread = Boolean(body.unread);
  const lead = await prisma.lead.findFirst({ where: { id, tenantId } });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.lead.update({
    where: { id },
    data: { adminUnread: unread },
  });
  return NextResponse.json({ ok: true, adminUnread: unread });
}
