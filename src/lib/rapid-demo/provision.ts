import { Prisma } from "@prisma/client";
import { upsertCapabilityInstance } from "@/lib/capability-instances";
import { prisma } from "@/lib/db";
import { bookingConfigFromFields } from "@/lib/flow/booking-config";
import {
  buildAgentSystemPrompt,
  catalogIdFromCapabilities,
  flowForCapabilities,
  hitlForCatalog,
} from "@/lib/flow/catalog";
import { parseReservationConfig } from "@/lib/flow/reservation-config";
import { defaultLeadSchema, validateFlow } from "@/lib/flow/validate";
import { ensureLocalDemoChannel } from "@/lib/provision-tenant";
import { withActivationNote, type RapidExtract } from "./extract";
import { RAPID_DEMO_CLERK_ORG_PREFIX } from "./guards";

export async function provisionRapidDemoTenant(profile: RapidExtract): Promise<{ tenantId: string }> {
  const name = profile.name?.trim() ?? "";
  const intro = profile.intro?.trim() ?? "";
  if (!name || !intro) throw new Error("Rapid demo requires a business name and intro");

  const capabilities = profile.capabilities;
  const catalogId = catalogIdFromCapabilities(capabilities);
  const flow = flowForCapabilities({ capabilities, bookingStance: "passive" });
  const hitlPolicy = hitlForCatalog(catalogId);
  validateFlow(flow, defaultLeadSchema, hitlPolicy);

  const phone = profile.phone?.trim() ?? "";
  const chatLanguage = profile.chatLanguage;
  const booking = bookingConfigFromFields({
    venueAddress: profile.venueAddress,
    venueHours: profile.venueHours,
  });
  const bookingConfig =
    booking.venueSchedule.length === 0
      ? bookingConfigFromFields({ venueAddress: profile.venueAddress, venueHours: "" })
      : booking;

  const tenant = await prisma.tenant.create({
    data: {
      clerkOrgId: `${RAPID_DEMO_CLERK_ORG_PREFIX}${crypto.randomUUID()}`,
      name,
      phone,
      intro,
      ownerEmail: "",
      chatLanguage,
    },
  });

  try {
    await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Inbox agent",
        catalogId,
        systemPrompt: buildAgentSystemPrompt(name, intro, phone, chatLanguage),
        knowledgeText: withActivationNote(profile.knowledgeMd),
        flow: flow as Prisma.InputJsonValue,
        leadSchema: defaultLeadSchema as Prisma.InputJsonValue,
        hitlPolicy: hitlPolicy as Prisma.InputJsonValue,
      },
    });
    await ensureLocalDemoChannel(tenant.id);

    if (capabilities.includes("booking")) {
      await upsertCapabilityInstance({ tenantId: tenant.id, capabilityId: "booking", config: bookingConfig });
    }
    if (capabilities.includes("reservations")) {
      await upsertCapabilityInstance({
        tenantId: tenant.id,
        capabilityId: "reservations",
        config: parseReservationConfig({}),
      });
    }
  } catch (err) {
    // The channel and capability helpers use the root client, so this cannot be one
    // transaction. Drop the tenant (cascade removes the agent and channel) instead
    // of leaving an orphan when a later step throws.
    await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    throw err;
  }

  return { tenantId: tenant.id };
}
