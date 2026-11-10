import { NextResponse } from "next/server";
import { syncSmartNpvTenant } from "@/lib/documents/client-sync";
import { SmartNpvAuthError } from "@/lib/documents/smart-npv";
import { tenantRoleOr403 } from "@/lib/tenant-role";

/** Run the new-client import for this tenant now. The hourly job uses the same path. */
export async function POST() {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  try {
    const outcome = await syncSmartNpvTenant(access.tenantId);
    if (outcome.status === "skipped") {
      return NextResponse.json({ error: outcome.reason }, { status: 400 });
    }
    return NextResponse.json({
      firstRun: outcome.firstRun,
      imported: outcome.imported,
      skipped: outcome.skipped,
      failed: outcome.failed,
      cursorDate: outcome.cursorDate,
    });
  } catch (err) {
    const code = err instanceof SmartNpvAuthError ? "auth" : "failed";
    console.warn(JSON.stringify({ msg: "documents.client_sync_failed", tenantId: access.tenantId, code }));
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
