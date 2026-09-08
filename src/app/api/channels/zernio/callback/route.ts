import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { bindZernioChannel } from "@/lib/channels/zernio-connect";
import { appOrigin } from "@/lib/request-url";

export async function GET(req: Request) {
  const tenantId = await requireTenantId();
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId") ?? "";
  const accountId = url.searchParams.get("accountId") ?? "";
  const username = url.searchParams.get("username") ?? "";
  const connected = url.searchParams.get("connected") ?? "whatsapp";
  const provider = connected === "instagram" ? "instagram" : "whatsapp";
  const appUrl = appOrigin();
  const fail = (msg: string) =>
    NextResponse.redirect(`${appUrl}/channels?error=${encodeURIComponent(msg)}`);

  const zernioError = url.searchParams.get("error");
  if (zernioError) {
    const detail =
      url.searchParams.get("error_message") ??
      url.searchParams.get("reason") ??
      zernioError;
    console.error("zernio connect callback error", {
      error: zernioError,
      platform: url.searchParams.get("platform"),
      detail,
    });
    return fail(detail);
  }

  if (!profileId || !accountId) return fail("missing_callback");
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  if (!tenant?.zernioProfileId || tenant.zernioProfileId !== profileId) {
    return fail("profile_mismatch");
  }
  try {
    await bindZernioChannel({
      tenantId,
      profileId,
      accountId,
      identity: username,
      provider,
    });
  } catch (err) {
    console.error("zernio callback bind failed", err);
    return fail("bind_failed");
  }
  const flag = provider === "instagram" ? "instagram" : "1";
  return NextResponse.redirect(`${appUrl}/channels?connected=${flag}`);
}
