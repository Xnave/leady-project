import { NextResponse } from "next/server";
import { requireTenantId } from "@/lib/tenant";
import { ensureZernioProfile } from "@/lib/channels/zernio-connect";
import { zernioConfigured, zernioWhatsAppConnectUrl } from "@/lib/zernio";

export async function POST() {
  const tenantId = await requireTenantId();
  if (!zernioConfigured()) {
    return NextResponse.json({ error: "Zernio is not configured" }, { status: 400 });
  }
  try {
    const profileId = await ensureZernioProfile(tenantId);
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const redirectUrl = `${appUrl}/api/channels/zernio/callback`;
    const url = await zernioWhatsAppConnectUrl({ profileId, redirectUrl });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("zernio connect start failed", err);
    return NextResponse.json({ error: "Could not start WhatsApp connect" }, { status: 502 });
  }
}
