import { prisma } from "@/lib/db";
import type { ScenarioSnapshot } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function personaGender(persona: unknown): "female" | "male" | "" {
  const gender = asRecord(persona).gender;
  return gender === "female" || gender === "male" ? gender : "";
}

export async function loadScenarioSnapshot(tenantId: string, leadId: string): Promise<ScenarioSnapshot | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      tenant: { select: { name: true, chatLanguage: true } },
      conversations: {
        orderBy: { createdAt: "asc" },
        include: {
          agent: { select: { persona: true } },
          messages: {
            orderBy: { createdAt: "asc" },
            select: { role: true, text: true, conversationId: true },
          },
          requests: { select: { id: true, capabilityId: true, status: true, timeText: true } },
          hitlTasks: { select: { id: true, type: true, status: true, reason: true } },
        },
      },
    },
  });
  if (!lead || lead.conversations.length === 0) return null;
  const latest = lead.conversations[lead.conversations.length - 1]!;
  return {
    tenantId,
    tenantName: lead.tenant.name,
    personaGender: personaGender(latest.agent.persona),
    chatLanguage: lead.tenant.chatLanguage,
    leadId: lead.id,
    externalUserId: lead.externalUserId,
    conversationId: latest.id,
    status: latest.status,
    flowState: latest.flowState,
    lifecycleReason: latest.lifecycleReason,
    crm: asRecord(lead.fields),
    session: asRecord(latest.session),
    messages: lead.conversations.flatMap((conversation) =>
      conversation.messages.map((message) => ({
        conversationId: message.conversationId,
        role: message.role,
        text: message.text,
      })),
    ),
    requests: lead.conversations.flatMap((conversation) => conversation.requests),
    hitl: lead.conversations.flatMap((conversation) => conversation.hitlTasks),
  };
}
