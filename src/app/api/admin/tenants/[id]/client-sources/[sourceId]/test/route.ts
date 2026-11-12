import { NextResponse } from "next/server";
import { adminTenantGate, sourceBelongsTo } from "@/lib/client-sources/admin-gate";
import { testClientSource } from "@/lib/client-sources/store";

/** Platform admins: fetch the first page, write nothing, return counts and field names only. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  const denied = await adminTenantGate(id);
  if (denied) return denied;
  if (!(await sourceBelongsTo(id, sourceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await testClientSource(id, sourceId));
}
