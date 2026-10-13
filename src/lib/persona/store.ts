import type { PrismaClient } from "@prisma/client";
import type { Persona } from "./types";
import { normalizePersona, validatePersona } from "./validate";

export type PersonaDb = Pick<PrismaClient, "agent" | "agentConfigRevision" | "$transaction">;

/** The tenant's agent (first created) with its normalized persona. */
export async function loadPersona(db: PersonaDb, tenantId: string) {
  const agent = await db.agent.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true, persona: true, tenant: { select: { name: true, chatLanguage: true } } },
  });
  if (!agent) return null;
  return {
    agentId: agent.id,
    persona: normalizePersona(agent.persona),
    tenantName: agent.tenant.name,
    chatLanguage: agent.tenant.chatLanguage,
  };
}

/** Validate, then write a persona revision and the agent column together. Never touches flowVersion. */
export async function savePersona(
  db: PersonaDb,
  a: { tenantId: string; agentId: string; raw: unknown; savedBy?: string },
): Promise<Persona> {
  const persona = validatePersona(a.raw);
  const agent = await db.agent.findFirst({
    where: { id: a.agentId, tenantId: a.tenantId },
    select: { id: true },
  });
  if (!agent) throw new Error("agent not found");
  const latest = await db.agentConfigRevision.findFirst({
    where: { tenantId: a.tenantId, agentId: a.agentId, kind: "persona" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  await db.$transaction([
    db.agentConfigRevision.create({
      data: {
        tenantId: a.tenantId,
        agentId: a.agentId,
        kind: "persona",
        version: (latest?.version ?? 0) + 1,
        payload: persona,
        savedBy: a.savedBy,
      },
    }),
    db.agent.update({ where: { id: a.agentId }, data: { persona } }),
  ]);
  return persona;
}
