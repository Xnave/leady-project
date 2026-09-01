import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { bindZernioWhatsApp } from "@/lib/channels/zernio-connect";

export async function GET(req: Request) {
  const tenantId = await requireTenantId();
  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId") ?? "";
  const accountId = url.searchParams.get("accountId") ?? "";
  const username = url.searchParams.get("username") ?? "";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const fail = (msg: string) =>
    NextResponse.redirect(`${appUrl}/channels?error=${encodeURIComponent(msg)}`);

  if (!profileId || !accountId) return fail("missing_callback");
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  if (!tenant?.zernioProfileId || tenant.zernioProfileId !== profileId) {
    return fail("profile_mismatch");
  }
  try {
    await bindZernioWhatsApp({
      tenantId,
      profileId,
      accountId,
      phone: username,
    });
  } catch (err) {
    console.error("zernio callback bind failed", err);
    return fail("bind_failed");
  }
  return NextResponse.redirect(`${appUrl}/channels?connected=1`);
}
