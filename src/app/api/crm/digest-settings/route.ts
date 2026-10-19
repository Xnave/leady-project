import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { prisma } from "@/lib/db";
import { OPT_IN_CODE_LENGTH, phoneDigits } from "@/lib/crm/digest";
import { resolveDigestSector } from "@/lib/crm/digest-templates";
import { digestFeatureOn } from "@/lib/crm/flags";
import { parseDigestSettingsBody } from "@/lib/crm/input";
import { requireTenantId } from "@/lib/tenant";

/** Same TTL the webhook enforces in `handleDigestReply`. */
const CODE_TTL_MS = 24 * 60 * 60 * 1000;

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
        select: {
          digestEnabled: true,
          digestHour: true,
          timezone: true,
          digestSector: true,
          alertsEnabled: true,
          alertApprovals: true,
          alertHandoffs: true,
          quietHoursEnabled: true,
          quietStartHour: true,
          quietEndHour: true,
          quietMode: true,
        },
      }),
      prisma.digestRecipient.findUnique({ where: { tenantId_clerkUserId: { tenantId, clerkUserId: actorUserId } } }),
      prisma.capabilityInstance.findMany({ where: { tenantId }, select: { capabilityId: true, enabled: true } }),
    ]);
    if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 404 });
    const codeLive =
      recipient?.optInCode && recipient.optInCodeAt && Date.now() - recipient.optInCodeAt.getTime() < CODE_TTL_MS;
    return NextResponse.json({
      featureOn: digestFeatureOn(),
      digestEnabled: tenant.digestEnabled,
      digestHour: tenant.digestHour,
      timezone: tenant.timezone,
      digestSector: tenant.digestSector,
      autoSector: resolveDigestSector("", capabilities),
      alerts: {
        enabled: tenant.alertsEnabled,
        approvals: tenant.alertApprovals,
        handoffs: tenant.alertHandoffs,
        quietHoursEnabled: tenant.quietHoursEnabled,
        quietStartHour: tenant.quietStartHour,
        quietEndHour: tenant.quietEndHour,
        quietMode: tenant.quietMode,
      },
      platformNumber: phoneDigits(process.env["DIGEST_WHATSAPP_NUMBER"] ?? ""),
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

    const { action, ...tenantFields } = body;
    if (Object.values(tenantFields).some((v) => v !== undefined)) {
      await prisma.tenant.update({ where: { id: tenantId }, data: tenantFields });
    }

    const key = { tenantId_clerkUserId: { tenantId, clerkUserId: actorUserId } };
    if (action === "connect") {
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
          if (attempt >= 4) throw e; // optInCode is unique; retry a collision
        }
      }
    } else if (action === "disconnect") {
      await prisma.digestRecipient.updateMany({
        where: { tenantId, clerkUserId: actorUserId },
        data: { optedInAt: null, optInCode: null, optInCodeAt: null },
      });
    }

    return GET();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Forbidden";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
