import { NextResponse } from "next/server";
import { requireTenantId } from "@/lib/tenant";
import { ensureZernioProfile } from "@/lib/channels/zernio-connect";
import { zernioConfigured, zernioWhatsAppConnectUrl } from "@/lib/zernio";
import { appOrigin } from "@/lib/request-url";

export async function POST() {
  const tenantId = await requireTenantId();
  if (!zernioConfigured()) {
    return NextResponse.json({ error: "Zernio is not configured" }, { status: 400 });
  }
  try {
    const profileId = await ensureZernioProfile(tenantId);
    const appUrl = appOrigin();
    const redirectUrl = `${appUrl}/api/channels/zernio/callback`;
    const url = await zernioWhatsAppConnectUrl({ profileId, redirectUrl });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("zernio connect start failed", err);
    const message = err instanceof Error ? err.message : "Could not start WhatsApp connect";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
