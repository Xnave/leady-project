import { NextResponse } from "next/server";
import { adminTenantGate, sourceBelongsTo } from "@/lib/client-sources/admin-gate";
import { requestSourceSync } from "@/lib/client-sources/dispatch";
import { safeErrorMessage } from "@/lib/client-sources/sync";

/** Platform admins: full sync of one source (queued on Inngest; inline locally). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { id, sourceId } = await params;
  const denied = await adminTenantGate(id);
  if (denied) return denied;
  if (!(await sourceBelongsTo(id, sourceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await requestSourceSync(id, sourceId, "full"));
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, []) }, { status: 502 });
  }
}
