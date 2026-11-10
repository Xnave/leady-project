import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnContext } from "@/lib/flow/types";

type LeadRow = { id: string; externalUserId: string; fields: Record<string, unknown> };
type ClientRow = { smartClientId: string; phone1: string; phone2: string; profile: Record<string, unknown>; createdOn: string };

const leads = new Map<string, LeadRow>();
const clients: ClientRow[] = [];
const dossiers: Array<Record<string, unknown>> = [];
const findClient = vi.fn(async () => {
  throw new Error("clients/get should not run");
});

vi.mock("@/lib/db", () => ({
  prisma: {
    capabilityInstance: {
      findFirst: async () => ({
        id: "cap1",
        capabilityId: "documents",
        kind: "mortgage",
        enabled: true,
        config: { apiKeyEnc: "stored-key", baseUrl: "https://www.snpv.co.il" },
      }),
    },
    dossier: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `d${dossiers.length + 1}`, createdAt: new Date(), ...data };
        dossiers.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: where.id,
        ...data,
      }),
    },
    leadDocument: {
      findMany: async () => [],
      count: async () => 0,
    },
    message: {
      findMany: async () => [],
      findFirst: async () => null,
    },
    lead: {
      findFirst: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        if (include) return null;
        return leads.get(where.id) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { fields: Record<string, unknown> } }) => {
        const lead = leads.get(where.id);
        if (lead) lead.fields = data.fields;
        return lead;
      },
    },
    smartNpvClient: {
      findFirst: async ({ where }: { where: { OR?: Array<{ phone1?: string; phone2?: string }> } }) => {
        const phone1 = where.OR?.find((item) => item.phone1)?.phone1;
        const phone2 = where.OR?.find((item) => item.phone2)?.phone2;
        return clients.find((row) => row.phone1 === phone1 || row.phone2 === phone2) ?? null;
      },
    },
  },
}));

const { loadDocumentsTurnState, runDocumentsIngest } = await import("./dossier");

function turn(phone: string): TurnContext {
  return {
    tenantId: "tenant-1",
    tenant: { id: "tenant-1", name: "Office", chatLanguage: "en" } as unknown as TurnContext["tenant"],
    agent: { persona: { gender: "female" } } as TurnContext["agent"],
    conversation: { id: "c1", status: "open", flowState: "talk", flowVersion: 1, nudgeCountByStage: {} },
    lead: { id: "lead-1", externalUserId: phone, fields: {} },
    messages: [{ role: "lead", text: "hello", createdAt: new Date() }],
  };
}

beforeEach(() => {
  leads.clear();
  clients.length = 0;
  dossiers.length = 0;
  findClient.mockClear();
});

describe("inbound phones", () => {
  it("opens a dossier from a stored phone and does not call clients/get", async () => {
    clients.push({
      smartClientId: "uuid-1",
      phone1: "0501234567",
      phone2: "0527654321",
      profile: { fullName: "Dana Levi" },
      createdOn: "2026-11-12",
    });
    const result = await runDocumentsIngest(turn("+972527654321"), {
      client: { findClient, listClients: async () => [], upload: async () => ({ remoteId: "" }) },
      readTurn: async () => ({ intents: [], source: "fallback" }),
    });
    expect(findClient).not.toHaveBeenCalled();
    expect(dossiers[0]?.smartClientId).toBe("uuid-1");
    expect(dossiers[0]?.status).not.toBe("needs_id");
    expect(result.reply).not.toMatch(/9-digit ID/);
  });

  it("says the number is unrecognized once and does not open a dossier", async () => {
    leads.set("lead-1", { id: "lead-1", externalUserId: "+972509999999", fields: {} });
    const first = await loadDocumentsTurnState({
      tenantId: "tenant-1",
      leadId: "lead-1",
      conversationId: "c1",
    });
    expect(first.runIngest).toBe(false);
    expect(first.unrecognized).toBe(true);
    expect(first.sayUnrecognized).toBe(true);
    expect(dossiers).toHaveLength(0);
    expect(leads.get("lead-1")?.fields.documentsUnrecognized).toBe(true);

    const second = await loadDocumentsTurnState({
      tenantId: "tenant-1",
      leadId: "lead-1",
      conversationId: "c1",
    });
    expect(second.sayUnrecognized).toBe(false);
    expect(second.unrecognized).toBe(true);
    expect(second.runIngest).toBe(false);
    expect(dossiers).toHaveLength(0);
  });
});
