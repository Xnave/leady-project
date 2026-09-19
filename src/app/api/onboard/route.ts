import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  catalogIdFromCapabilities,
  flowForCapabilities,
  hitlForCatalog,
  isBookingStance,
  isCapabilityId,
  type BookingStance,
  type CapabilityId,
} from "@/lib/flow/catalog";
import { sanitizeBookingCollect } from "@/lib/flow/booking-collect";
import { parseReservationConfig } from "@/lib/flow/reservation-config";
import type { BookingConfig } from "@/lib/flow/booking-config";
import {
  DEFAULT_INSTANCE_KIND,
  disableCapabilityInstance,
  upsertCapabilityInstance,
} from "@/lib/capability-instances";
import { isChatLanguage, type ChatLanguage } from "@/lib/flow/locale";
import { defaultLeadSchema, validateFlow } from "@/lib/flow/validate";
import { FlowConfigError } from "@/lib/flow/types";
import { buildAgentSystemPrompt } from "@/lib/flow/catalog";
import { requireTenantId } from "@/lib/tenant";

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  const body = (await req.json()) as {
    name?: string;
    phone?: string;
    intro?: string;
    knowledgeText?: string;
    catalogId?: string;
    capabilities?: unknown;
    bookingStance?: string;
    chatLanguage?: string;
    idleResetDays?: number;
    bookingCollect?: unknown;
    venueAddress?: string;
    venueHours?: string;
    bookingRequestTemplate?: string;
    bookingApprovedTemplate?: string;
    bookingRejectedTemplate?: string;
    reservationConfig?: unknown;
  };

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const intro = String(body.intro ?? "").trim();
  const knowledgeText = String(body.knowledgeText ?? "");
  const chatLanguage: ChatLanguage = isChatLanguage(String(body.chatLanguage ?? "multi"))
    ? (body.chatLanguage as ChatLanguage)
    : "multi";

  const capabilities: CapabilityId[] = Array.isArray(body.capabilities)
    ? body.capabilities.filter((c): c is CapabilityId => typeof c === "string" && isCapabilityId(c))
    : body.catalogId === "faq"
      ? []
      : ["booking"];

  const bookingStance: BookingStance =
    body.bookingStance && isBookingStance(body.bookingStance)
      ? body.bookingStance
      : body.catalogId === "book"
        ? "proactive"
        : "passive";

  const catalogId = catalogIdFromCapabilities(capabilities);

  if (!name) {
    return NextResponse.json({ error: "Business name is required" }, { status: 400 });
  }
  if (!intro) {
    return NextResponse.json({ error: "Intro is required" }, { status: 400 });
  }
  const idleRaw = Number(body.idleResetDays);
  const idleResetDays = Number.isFinite(idleRaw)
    ? Math.max(0, Math.min(365, Math.floor(idleRaw)))
    : 5;

  const flow = flowForCapabilities({
    capabilities,
    bookingStance,
    requiredForBook: sanitizeBookingCollect(body.bookingCollect),
  });
  const hitlPolicy = hitlForCatalog(catalogId);
  try {
    validateFlow(flow, defaultLeadSchema, hitlPolicy);
  } catch (e) {
    const msg = e instanceof FlowConfigError ? e.errors.join("\n") : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const systemPrompt = buildAgentSystemPrompt(name, intro, phone, chatLanguage);
  const instanceConfigs: { capabilityId: CapabilityId; config: unknown }[] = [
    {
      capabilityId: "booking",
      config: {
        venueAddress: String(body.venueAddress ?? "").trim(),
        venueHours: String(body.venueHours ?? "").trim(),
        messageTemplates: {
          request: String(body.bookingRequestTemplate ?? ""),
          approved: String(body.bookingApprovedTemplate ?? ""),
          rejected: String(body.bookingRejectedTemplate ?? ""),
        },
      } satisfies BookingConfig,
    },
    ...(body.reservationConfig !== undefined
      ? [
          {
            capabilityId: "reservations" as const,
            config: parseReservationConfig(body.reservationConfig),
          },
        ]
      : []),
  ];
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId } });
  let agent = await prisma.agent.findFirst({ where: { tenantId } });

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        name,
        phone,
        intro,
        chatLanguage,
        idleResetDays,
      },
    });

    const payload = { catalogId, capabilities, bookingStance, flow };

    if (!agent) {
      agent = await tx.agent.create({
        data: {
          tenantId,
          name: "Inbox agent",
          catalogId,
          systemPrompt,
          knowledgeText,
          flow,
          leadSchema: defaultLeadSchema,
          hitlPolicy,
        },
      });
      return;
    }

    const nextVersion = agent.flowVersion + 1;
    await tx.agentConfigRevision.create({
      data: {
        tenantId,
        agentId: agent.id,
        kind: "flow",
        version: nextVersion,
        payload,
      },
    });
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        catalogId,
        systemPrompt,
        knowledgeText,
        flow,
        flowVersion: nextVersion,
        flowChangedAt: new Date(),
        hitlPolicy,
        leadSchema: defaultLeadSchema,
      },
    });
  });

  // One instance per capability the owner enabled; the rest stay configured but off.
  for (const { capabilityId, config } of instanceConfigs) {
    if (capabilities.includes(capabilityId)) {
      await upsertCapabilityInstance({ tenantId, capabilityId, config });
    } else {
      await disableCapabilityInstance({
        tenantId,
        kind: DEFAULT_INSTANCE_KIND[capabilityId] ?? capabilityId,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
