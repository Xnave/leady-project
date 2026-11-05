import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/admin";
import { prisma } from "@/lib/db";

/** Platform admins only, and the tenant must exist. Returns a response to send back, or null to continue. */
export async function adminTenantGate(tenantId: string): Promise<NextResponse | null> {
  if (!(await isAdminSession())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return null;
}

/** The source must belong to the tenant in the URL. */
export async function sourceBelongsTo(tenantId: string, sourceId: string): Promise<boolean> {
  return (await prisma.clientSource.count({ where: { id: sourceId, tenantId } })) > 0;
}
