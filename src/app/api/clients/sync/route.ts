import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestSourceSync } from "@/lib/client-sources/dispatch";
import { safeErrorMessage } from "@/lib/client-sources/sync";
import { tenantRoleOr403 } from "@/lib/tenant-role";

/** Owner/admin: "sync now" on the Clients tab. Pulls every source the tenant has. */
export async function POST() {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const sources = await prisma.clientSource.findMany({ where: { tenantId: access.tenantId }, select: { id: true } });
  if (!sources.length) return NextResponse.json({ error: "no_sources" }, { status: 404 });
  try {
    const results = [];
    for (const s of sources) results.push(await requestSourceSync(access.tenantId, s.id, "full"));
    return NextResponse.json({ queued: results.every((r) => r.queued) });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, []) }, { status: 502 });
  }
}
