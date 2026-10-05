import { NextResponse } from "next/server";
import { tenantRoleOr403 } from "@/lib/tenant-role";
import { syncHookMyAppChannels } from "@/lib/hookmyapp-sync";
import { redirectPath } from "@/lib/request-url";

export async function POST(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  try {
    const synced = await syncHookMyAppChannels(tenantId);
    const url = redirectPath(req, "/channels");
    url.searchParams.set("synced", synced.join(",") || "none");
    return NextResponse.redirect(url, 303);
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "sync failed", { status: 400 });
  }
}
