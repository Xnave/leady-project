import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import {
  createOnboardingLink,
  ensureCustomerWorkspace,
  hookmyappConfigured,
} from "@/lib/hookmyapp";

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  if (!hookmyappConfigured()) {
    return new NextResponse(
      "Set HOOKMYAPP_API_KEY and HOOKMYAPP_ORG_ID in .env",
      { status: 400 },
    );
  }
  const form = await req.formData();
  const channelType = String(form.get("channelType") ?? "whatsapp") as
    | "whatsapp"
    | "instagram";
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId } });
  const workspaceId = await ensureCustomerWorkspace({
    name: tenant.name,
    externalId: tenant.id,
    existingWorkspaceId: tenant.hookmyappWorkspaceId,
  });
  if (workspaceId !== tenant.hookmyappWorkspaceId) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { hookmyappWorkspaceId: workspaceId },
    });
  }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const verifyToken = `leady-${tenantId.slice(0, 12)}`;
  const link = await createOnboardingLink({
    channelType,
    label: `${tenant.name} ${channelType}`,
    workspaceId,
    webhookUrl: `${appUrl}/api/webhooks/meta`,
    verifyToken,
    successRedirectUrl: `${appUrl}/channels?connected=1`,
    connectedNotificationUrl: `${appUrl}/api/webhooks/hookmyapp/connected`,
  });
  return NextResponse.redirect(link.url, 303);
}
