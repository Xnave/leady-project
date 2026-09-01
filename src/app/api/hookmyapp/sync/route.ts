import { NextResponse } from "next/server";
import { requireTenantId } from "@/lib/tenant";
import { syncHookMyAppChannels } from "@/lib/hookmyapp-sync";

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  try {
    const synced = await syncHookMyAppChannels(tenantId);
    const url = new URL("/channels", req.url);
    url.searchParams.set("synced", synced.join(",") || "none");
    return NextResponse.redirect(url, 303);
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "sync failed", { status: 400 });
  }
}
