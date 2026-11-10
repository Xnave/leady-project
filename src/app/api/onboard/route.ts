import { NextResponse } from "next/server";
import { tryValidatePersona } from "@/lib/persona/validate";
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
import { bookingConfigFromFields } from "@/lib/flow/booking-config";
import {
  DEFAULT_INSTANCE_KIND,
  disableCapabilityInstance,
  loadInstanceConfig,
  upsertCapabilityInstance,
} from "@/lib/capability-instances";
import { parseDocumentConfig, type DocumentConfig } from "@/lib/flow/document-config";
import { startClientSyncOnKeySave } from "@/lib/documents/client-sync";
import { isChatLanguage, type ChatLanguage } from "@/lib/flow/locale";
import { defaultLeadSchema, validateFlow } from "@/lib/flow/validate";
import { FlowConfigError } from "@/lib/flow/types";
import { buildAgentSystemPrompt } from "@/lib/flow/catalog";
import { tenantRoleOr403 } from "@/lib/tenant-role";

export async function POST(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
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
    documentConfig?: unknown;
    persona?: unknown;
  };

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const intro = String(body.intro ?? "").trim();
  const knowledgeText = String(body.knowledgeText ?? "");
  // Missing/invalid persona keeps whatever the owner saved in Settings → Your agent.
  const persona = tryValidatePersona(body.persona);
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
  const venueHours = String(body.venueHours ?? "").trim();
  const bookingConfig = bookingConfigFromFields({
    venueAddress: String(body.venueAddress ?? "").trim(),
    venueHours,
    messageTemplates: {
      request: String(body.bookingRequestTemplate ?? ""),
      approved: String(body.bookingApprovedTemplate ?? ""),
      rejected: String(body.bookingRejectedTemplate ?? ""),
    },
  });
  if (venueHours && bookingConfig.venueSchedule.length === 0) {
    return NextResponse.json(
      {
        error:
          "Opening hours could not be parsed into bookable day/time windows. Use day lists and clock ranges (e.g. Sun–Thu 09:00–19:00 or א', ג', ה' 09:00-19:00 | שישי 09:00-13:00).",
      },
      { status: 400 },
    );
  }
  let documentConfig: unknown = {};
  let savedDocuments: DocumentConfig | null = null;
  if (capabilities.includes("documents")) {
    const existing = await loadInstanceConfig({ tenantId, capabilityId: "documents" });
    try {
      const existingPhones = Array.isArray(existing.testPhones)
        ? existing.testPhones.filter((item): item is string => typeof item === "string")
        : [];
      savedDocuments = parseDocumentConfig(
        body.documentConfig,
        typeof existing.apiKeyEnc === "string" ? existing.apiKeyEnc : "",
        existingPhones,
      );
      documentConfig = savedDocuments;
    } catch (e) {
      const msg = e instanceof FlowConfigError ? e.errors.join("\n") : String(e);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }
  const instanceConfigs: { capabilityId: CapabilityId; config: unknown }[] = [
    {
      capabilityId: "booking",
      config: bookingConfig,
    },
    { capabilityId: "documents", config: documentConfig },
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
          ...(persona ? { persona } : {}),
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
        ...(persona ? { persona } : {}),
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

  let documentsSync: { firstRun: true; cursorDate: string; imported: number; failed: number } | null = null;
  if (savedDocuments?.apiKeyEnc) {
    try {
      const started = await startClientSyncOnKeySave(tenantId);
      if (started) {
        documentsSync = {
          firstRun: true,
          cursorDate: started.cursorDate,
          imported: started.imported,
          failed: started.failed,
        };
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          msg: "documents.client_sync_failed",
          tenantId,
          code: err instanceof Error ? err.name : "failed",
        }),
      );
    }
  }

  return NextResponse.json({
    ok: true,
    documents: savedDocuments
      ? { hasKey: Boolean(savedDocuments.apiKeyEnc), sync: documentsSync }
      : null,
  });
}
