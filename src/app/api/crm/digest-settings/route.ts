import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { prisma } from "@/lib/db";
import { digestFeatureOn } from "@/lib/crm/flags";
import { looksLikePhoneNumber } from "@/lib/flow/booking-collect";
import { requireTenantId } from "@/lib/tenant";

export async function GET() {
  try {
    const tenantId = await requireTenantId();
    const { actorUserId } = await resolveStaffActor();
    const [tenant, recipient] = await Promise.all([
      prisma.tenant.findFirst({ where: { id: tenantId }, select: { digestEnabled: true, digestHour: true, timezone: true } }),
      prisma.digestRecipient.findUnique({ where: { tenantId_clerkUserId: { tenantId, clerkUserId: actorUserId } } }),
    ]);
    if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 404 });
    return NextResponse.json({
      featureOn: digestFeatureOn(),
      digestEnabled: tenant.digestEnabled,
      digestHour: tenant.digestHour,
      timezone: tenant.timezone,
      me: recipient ? { phone: recipient.phone, optedIn: recipient.optedInAt != null } : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Forbidden";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PUT(req: Request) {
  try {
    const tenantId = await requireTenantId();
    const { actorUserId, actorLabel } = await resolveStaffActor();
    const body = (await req.json().catch(() => ({}))) as {
      digestEnabled?: unknown;
      digestHour?: unknown;
      phone?: unknown;
      optIn?: unknown;
    };

    if (typeof body.digestEnabled === "boolean" || typeof body.digestHour === "number") {
      const data: { digestEnabled?: boolean; digestHour?: number } = {};
      if (typeof body.digestEnabled === "boolean") data.digestEnabled = body.digestEnabled;
      if (typeof body.digestHour === "number") {
        if (!Number.isInteger(body.digestHour) || body.digestHour < 0 || body.digestHour > 23) {
          return NextResponse.json({ error: "digestHour must be 0-23" }, { status: 400 });
        }
        data.digestHour = body.digestHour;
      }
      await prisma.tenant.update({ where: { id: tenantId }, data });
    }

    if (typeof body.phone === "string" || typeof body.optIn === "boolean") {
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      if (phone && !looksLikePhoneNumber(phone)) {
        return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
      }
      const optIn = body.optIn === true;
      if (optIn && !phone) {
        return NextResponse.json({ error: "Phone number required to opt in" }, { status: 400 });
      }
      await prisma.digestRecipient.upsert({
        where: { tenantId_clerkUserId: { tenantId, clerkUserId: actorUserId } },
        create: { tenantId, clerkUserId: actorUserId, label: actorLabel, phone, optedInAt: optIn ? new Date() : null },
        update: { label: actorLabel, ...(phone ? { phone } : {}), optedInAt: optIn ? new Date() : null },
      });
    }

    return GET();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Forbidden";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
