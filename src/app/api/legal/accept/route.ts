import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AGREEMENT_VERSION, pendingAgreement } from "@/lib/legal/agreement";
import { redirectPath } from "@/lib/request-url";

/** Click-wrap acceptance by the tenant owner. Records version, time, user, IP and user agent (agreement 17.7). */
export async function POST(req: Request) {
  const pending = await pendingAgreement();
  if (!pending) return NextResponse.redirect(redirectPath(req, "/"), 303);

  const form = await req.formData();
  if (form.get("agree") !== "on" || form.get("version") !== AGREEMENT_VERSION) {
    return NextResponse.redirect(redirectPath(req, "/accept-agreement?error=1"), 303);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  await prisma.agreementAcceptance.upsert({
    where: { tenantId_version: { tenantId: pending.tenantId, version: AGREEMENT_VERSION } },
    create: {
      tenantId: pending.tenantId,
      version: AGREEMENT_VERSION,
      clerkUserId: pending.userId,
      email: pending.email ?? "",
      ip: ip.slice(0, 64),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 512),
    },
    update: {},
  });
  return NextResponse.redirect(redirectPath(req, "/"), 303);
}
