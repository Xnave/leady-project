import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const body = z.object({ unread: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_body" }, { status: 400 });
  const unread = body.data.unread === true;
  const result = await prisma.lead.updateMany({
    where: { id, tenantId },
    data: { adminUnread: unread },
  });
  if (result.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, adminUnread: unread });
}
