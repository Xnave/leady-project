import { NextResponse } from "next/server";
import { requireTenantId } from "@/lib/tenant";
import { ensureZernioProfile } from "@/lib/channels/zernio-connect";
import { zernioConfigured, zernioConnectUrl } from "@/lib/zernio";
import { appOrigin } from "@/lib/request-url";

type Platform = "whatsapp" | "instagram";

function parsePlatform(value: unknown): Platform {
  return value === "instagram" ? "instagram" : "whatsapp";
}

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  if (!zernioConfigured()) {
    return NextResponse.json({ error: "Zernio is not configured" }, { status: 400 });
  }
  let provider: Platform = "whatsapp";
  try {
    const body = (await req.json().catch(() => ({}))) as { provider?: string };
    provider = parsePlatform(body.provider);
  } catch {
    provider = "whatsapp";
  }
  try {
    const profileId = await ensureZernioProfile(tenantId);
    const appUrl = appOrigin();
    const redirectUrl = `${appUrl}/api/channels/zernio/callback`;
    const url = await zernioConnectUrl({ platform: provider, profileId, redirectUrl });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("zernio connect start failed", err);
    const message = err instanceof Error ? err.message : "Could not start connect";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
