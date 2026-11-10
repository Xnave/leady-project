/**
 * Load the booking and hold-reservation tenants the scenario scripts assume.
 *
 *   npm run scenarios:load-tenants
 *
 * Fixtures live in `tenants/booking.json` and `tenants/reservation.json`.
 * The script writes tenant, agent, and capability-instance config. It does not
 * copy leads, messages, or channel tokens. A local demo channel is added when
 * the tenant has none.
 *
 * An id already in the environment is updated in place:
 * booking uses `SCENARIO_BOOKING_TENANT_ID` or `DEV_TENANT_ID`, and the hold
 * tenant uses `SCENARIO_RESERVATION_TENANT_ID`. When that id is empty, the
 * script creates or updates the org `scenario-booking` / `scenario-reservation`
 * and prints the id to put in `.env`.
 *
 * Reloading an unchanged flow does not bump `flowVersion`. A flow change does,
 * and writes an agent config revision.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { ensureLocalDemoChannel } from "../../src/lib/provision-tenant";

type Fixture = {
  key: "booking" | "reservation";
  clerkOrgId: string;
  tenant: {
    name: string;
    phone: string;
    intro: string;
    ownerEmail: string;
    chatLanguage: string;
    idleResetDays: number;
    timezone: string;
    digestEnabled: boolean;
    digestHour: number;
    digestSector: string;
    agentRepliesEnabled: boolean;
    mediaAnalysisEnabled: boolean;
  };
  agent: {
    name: string;
    catalogId: string;
    systemPrompt: string;
    knowledgeText: string;
    persona: Prisma.JsonValue;
    flow: Prisma.JsonValue;
    leadSchema: Prisma.JsonValue;
    hitlPolicy: Prisma.JsonValue;
    mediaAnalysis: boolean;
  };
  capabilityInstances: {
    capabilityId: string;
    kind: string;
    enabled: boolean;
    config: Prisma.JsonValue;
  }[];
};

const ENV_KEYS = [
  "DATABASE_URL",
  "APP_ENCRYPTION_KEY",
  "SCENARIO_BOOKING_TENANT_ID",
  "SCENARIO_RESERVATION_TENANT_ID",
  "DEV_TENANT_ID",
] as const;

function loadDotEnv() {
  let text = "";
  try {
    text = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!value || process.env[key]) continue;
    if ((ENV_KEYS as readonly string[]).includes(key)) process.env[key] = value;
  }
}

function json(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return current;
    return Object.fromEntries(
      Object.keys(current as Record<string, unknown>)
        .sort()
        .map((key) => [key, (current as Record<string, unknown>)[key]]),
    );
  });
}

function readFixture(key: Fixture["key"]): Fixture {
  const path = join(dirname(fileURLToPath(import.meta.url)), "tenants", `${key}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

function targetId(fixture: Fixture): string {
  if (fixture.key === "booking") {
    return (
      process.env.SCENARIO_BOOKING_TENANT_ID?.trim() ||
      process.env.DEV_TENANT_ID?.trim() ||
      ""
    );
  }
  return process.env.SCENARIO_RESERVATION_TENANT_ID?.trim() || "";
}

async function loadFixture(prisma: PrismaClient, fixture: Fixture) {
  const envId = targetId(fixture);
  const existing = envId
    ? await prisma.tenant.findUnique({ where: { id: envId } })
    : await prisma.tenant.findUnique({ where: { clerkOrgId: fixture.clerkOrgId } });
  if (envId && !existing) {
    throw new Error(`${fixture.key} tenant ${envId} is not in the database`);
  }

  const tenant = existing
    ? await prisma.tenant.update({ where: { id: existing.id }, data: fixture.tenant })
    : await prisma.tenant.create({
        data: { clerkOrgId: fixture.clerkOrgId, ...fixture.tenant },
      });

  const agentFields = {
    name: fixture.agent.name,
    catalogId: fixture.agent.catalogId,
    systemPrompt: fixture.agent.systemPrompt,
    knowledgeText: fixture.agent.knowledgeText,
    persona: json(fixture.agent.persona),
    flow: json(fixture.agent.flow),
    leadSchema: json(fixture.agent.leadSchema),
    hitlPolicy: json(fixture.agent.hitlPolicy),
    mediaAnalysis: fixture.agent.mediaAnalysis,
  };
  const agent = await prisma.agent.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
  });
  let flowVersion = agent?.flowVersion ?? 1;
  if (!agent) {
    const created = await prisma.agent.create({
      data: { tenantId: tenant.id, ...agentFields, flowVersion: 1 },
    });
    flowVersion = created.flowVersion;
  } else if (stable(agent.flow) !== stable(fixture.agent.flow)) {
    flowVersion = agent.flowVersion + 1;
    await prisma.$transaction([
      prisma.agentConfigRevision.create({
        data: {
          tenantId: tenant.id,
          agentId: agent.id,
          kind: "flow",
          version: flowVersion,
          payload: { catalogId: fixture.agent.catalogId, flow: json(fixture.agent.flow) },
          savedBy: "scenario-tenant-load",
        },
      }),
      prisma.agent.update({
        where: { id: agent.id },
        data: { ...agentFields, flowVersion, flowChangedAt: new Date() },
      }),
    ]);
  } else {
    await prisma.agent.update({ where: { id: agent.id }, data: agentFields });
  }

  for (const instance of fixture.capabilityInstances) {
    await prisma.capabilityInstance.upsert({
      where: { tenantId_kind: { tenantId: tenant.id, kind: instance.kind } },
      create: {
        tenantId: tenant.id,
        capabilityId: instance.capabilityId,
        kind: instance.kind,
        enabled: instance.enabled,
        config: json(instance.config),
      },
      update: {
        capabilityId: instance.capabilityId,
        enabled: instance.enabled,
        config: json(instance.config),
      },
    });
  }

  await ensureLocalDemoChannel(tenant.id);
  const action = existing ? "updated" : "created";
  console.log(`${fixture.key} ${action} ${tenant.id} flowVersion=${flowVersion}`);
  if (!existing) {
    const envName =
      fixture.key === "booking" ? "SCENARIO_BOOKING_TENANT_ID" : "SCENARIO_RESERVATION_TENANT_ID";
    console.log(`Set ${envName}=${tenant.id}`);
  }
}

async function main() {
  loadDotEnv();
  const prisma = new PrismaClient();
  try {
    await loadFixture(prisma, readFixture("booking"));
    await loadFixture(prisma, readFixture("reservation"));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
