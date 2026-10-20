import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { prisma } from "@/lib/db";
import { OPT_IN_CODE_LENGTH, OPT_IN_CODE_TTL_MS } from "@/lib/crm/digest";
import { resolveDigestSector } from "@/lib/crm/digest-templates";
import { digestFeatureOn, digestPlatformNumber } from "@/lib/crm/flags";
import { parseDigestSettingsBody } from "@/lib/crm/input";
import { requireTenantId } from "@/lib/tenant";

function newCode(): string {
  return String(randomInt(0, 10 ** OPT_IN_CODE_LENGTH)).padStart(OPT_IN_CODE_LENGTH, "0");
}

export async function GET() {
  try {
    const tenantId = await requireTenantId();
    const { actorUserId } = await resolveStaffActor();
    const [tenant, recipient, capabilities] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: tenantId },
        select: { digestEnabled: true, digestHour: true, timezone: true, digestSector: true },
      }),
      prisma.digestRecipient.findUnique({ where: { tenantId_clerkUserId: { tenantId, clerkUserId: actorUserId } } }),
      prisma.capabilityInstance.findMany({ where: { tenantId }, select: { capabilityId: true, enabled: true } }),
    ]);
    if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 404 });
    const codeLive =
      recipient?.optInCode && recipient.optInCodeAt && Date.now() - recipient.optInCodeAt.getTime() < OPT_IN_CODE_TTL_MS;
    return NextResponse.json({
      featureOn: digestFeatureOn(),
      digestEnabled: tenant.digestEnabled,
      digestHour: tenant.digestHour,
      timezone: tenant.timezone,
      digestSector: tenant.digestSector,
      autoSector: resolveDigestSector("", capabilities),
      platformNumber: digestPlatformNumber(),
      me: recipient
        ? {
            phone: recipient.optedInAt ? recipient.phone : "",
            optedIn: recipient.optedInAt != null,
            code: codeLive ? recipient.optInCode : null,
          }
        : null,
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
    const body = parseDigestSettingsBody(await req.json().catch(() => ({})));
    if ("error" in body) return NextResponse.json(body, { status: 400 });

    if (body.digestEnabled !== undefined || body.digestHour !== undefined || body.digestSector !== undefined) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { digestEnabled: body.digestEnabled, digestHour: body.digestHour, digestSector: body.digestSector },
      });
    }

    const key = { tenantId_clerkUserId: { tenantId, clerkUserId: actorUserId } };
    if (body.action === "connect") {
      // The phone is never typed here: it is taken from the WhatsApp sender
      // when the owner sends `START <code>` to the platform number.
      for (let attempt = 0; ; attempt++) {
        const code = { optInCode: newCode(), optInCodeAt: new Date() };
        try {
          await prisma.digestRecipient.upsert({
            where: key,
            create: { tenantId, clerkUserId: actorUserId, label: actorLabel, phone: "", ...code },
            update: { label: actorLabel, ...code },
          });
          break;
        } catch (e) {
          // `optInCode` is unique because START looks a code up across every
          // tenant: a collision would bind the wrong business. Retry it.
          const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
          if (!collision || attempt >= 4) throw e;
        }
      }
    } else if (body.action === "disconnect") {
      // Nothing references the row, and `connect` upserts it again, so drop
      // the phone and conversation along with the opt-in.
      await prisma.digestRecipient.deleteMany({ where: { tenantId, clerkUserId: actorUserId } });
    }

    return GET();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Forbidden";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
