import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/org-roles";

export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CLERK_WEBHOOK_SECRET not configured" }, { status: 501 });
  }

  let event;
  try {
    event = await verifyWebhook(req, { signingSecret: secret });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "organizationMembership.created") {
    const membership = event.data;
    const orgId = membership.organization.id;
    const userId = membership.public_user_data?.user_id;
    const email = membership.public_user_data?.identifier;
    if (userId && email) {
      const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
      if (
        tenant &&
        !tenant.ownerClerkUserId &&
        normalizeEmail(tenant.ownerEmail) === normalizeEmail(email)
      ) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { ownerClerkUserId: userId },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
