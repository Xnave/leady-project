import { beforeEach, describe, expect, it, vi } from "vitest";
import { DECLARATION_VERSION } from "./rules";

const campaignRow = {
  id: "c1",
  tenantId: "t1",
  name: "Refinance",
  templateId: "tpl",
  status: "draft",
  scheduledAt: null as Date | null,
  materializedAt: null as Date | null,
  batchStartAt: 0,
  audience: { kind: "leads", leadIds: ["l1"] },
  params: [{ source: "first_name", value: "", fallback: "שלום" }],
  template: { status: "APPROVED", body: "היי {{1}}", category: "MARKETING" },
  tenant: { name: "Biz" },
};
const declarations: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const sends: unknown[] = [];
const order: string[] = [];
let enabled = true;
let freezeResult: "audience_too_large" | null = null;
let stealDraft = false;

vi.mock("@/lib/db", () => {
  const campaign = {
    findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
      if (where.id !== campaignRow.id || where.tenantId !== campaignRow.tenantId) return null;
      const snap = { ...campaignRow };
      if (stealDraft) campaignRow.status = "scheduled";
      return snap;
    },
    updateMany: async (a: { where: { status: string }; data: Record<string, unknown> }) => {
      if (campaignRow.status !== a.where.status) return { count: 0 };
      updates.push(a.data);
      Object.assign(campaignRow, a.data);
      return { count: 1 };
    },
  };
  const ownerDeclaration = {
    create: async (a: { data: Record<string, unknown> }) => {
      order.push("decl");
      declarations.push(a.data);
    },
  };
  const campaignSend = {
    createMany: async (a: { data: unknown[] }) => {
      sends.push(...a.data);
      return { count: a.data.length };
    },
    count: async () => 9,
  };
  const whatsAppTemplate = {
    findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
      where.id === "tpl" && where.tenantId === "t1" ? { id: "tpl", status: "APPROVED", body: "היי {{1}}" } : null,
  };
  return {
    prisma: {
      campaign,
      ownerDeclaration,
      campaignSend,
      whatsAppTemplate,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ campaign, ownerDeclaration, campaignSend }),
    },
  };
});
vi.mock("./store", () => ({
  loadCampaignSettings: async () => ({ enabled, termsVersion: "2026-11-03", termsAcceptedAt: new Date().toISOString() }),
}));
vi.mock("./engine", () => ({
  parseAudience: (a: unknown) => a,
  parseParamSpecs: (p: unknown) => p,
  previewCampaign: async () => ({ total: 1, eligible: 1, skipped: {}, sample: ["Dana"], costUsd: 0.04 }),
  freezeAudience: async (tx: { campaignSend: { createMany: (a: { data: unknown[] }) => Promise<unknown> } }) => {
    if (freezeResult) return freezeResult;
    await tx.campaignSend.createMany({ data: [{ phone: "972501111111", status: "queued" }] });
    order.push("rows");
    return null;
  },
}));

const { actOnCampaign, confirmCampaign, updateCampaign } = await import("./manage");
const actor = { actorUserId: "owner@x", actorLabel: "owner@x" };

beforeEach(() => {
  campaignRow.status = "draft";
  campaignRow.name = "Refinance";
  campaignRow.materializedAt = null;
  campaignRow.batchStartAt = 0;
  declarations.length = 0;
  updates.length = 0;
  sends.length = 0;
  order.length = 0;
  enabled = true;
  freezeResult = null;
  stealDraft = false;
});

describe("confirmCampaign", () => {
  it("refuses without the ticked declaration of the current version", async () => {
    expect(await confirmCampaign("t1", "c1", actor, {})).toEqual({ error: "declaration_required" });
    expect(await confirmCampaign("t1", "c1", actor, { declarationAccepted: true, declarationVersion: "old" })).toEqual({
      error: "declaration_required",
    });
    expect(campaignRow.status).toBe("draft");
    expect(declarations).toHaveLength(0);
  });

  it("stores the declaration text, version and actor with the schedule", async () => {
    const res = await confirmCampaign("t1", "c1", actor, { declarationAccepted: true, declarationVersion: DECLARATION_VERSION, language: "he" });
    expect(res).toMatchObject({ ok: true, recipients: 1 });
    expect(campaignRow.status).toBe("scheduled");
    expect(campaignRow.materializedAt).toBeInstanceOf(Date);
    expect(sends).toEqual([expect.objectContaining({ phone: "972501111111", status: "queued" })]);
    expect(order).toEqual(["rows", "decl"]);
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      tenantId: "t1",
      campaignId: "c1",
      actorLabel: "owner@x",
      textVersion: DECLARATION_VERSION,
      language: "he",
      recipientCount: 1,
    });
    expect(String(declarations[0].text)).toContain("אחריות מלאה");
  });

  it("cannot confirm twice or confirm another tenant's campaign", async () => {
    const body = { declarationAccepted: true, declarationVersion: DECLARATION_VERSION };
    await confirmCampaign("t1", "c1", actor, body);
    expect(await confirmCampaign("t1", "c1", actor, body)).toEqual({ error: "not_draft" });
    campaignRow.status = "draft";
    expect(await confirmCampaign("t2", "c1", actor, body)).toEqual({ error: "not_found" });
  });

  it("is blocked when the add-on is off", async () => {
    enabled = false;
    expect(await confirmCampaign("t1", "c1", actor, { declarationAccepted: true, declarationVersion: DECLARATION_VERSION })).toEqual({
      error: "not_enabled",
    });
  });

  it("does not schedule an audience over the cap", async () => {
    freezeResult = "audience_too_large";
    expect(await confirmCampaign("t1", "c1", actor, { declarationAccepted: true, declarationVersion: DECLARATION_VERSION })).toEqual({
      error: "audience_too_large",
    });
    expect(campaignRow.status).toBe("draft");
    expect(declarations).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });

  it("does not change a campaign that left draft during the save", async () => {
    stealDraft = true;
    const res = await updateCampaign("t1", "c1", {
      name: "Changed",
      templateId: "tpl",
      audience: { kind: "leads", leadIds: ["l1"] },
      params: [{ source: "first_name", value: "", fallback: "שלום" }],
    });
    expect(res).toEqual({ error: "not_draft" });
    expect(campaignRow.name).toBe("Refinance");
    expect(campaignRow.status).toBe("scheduled");
  });
});

describe("actOnCampaign", () => {
  it("asks the next run to sample the batch and does not sample it now", async () => {
    campaignRow.status = "paused";
    campaignRow.batchStartAt = 4;
    expect(await actOnCampaign("t1", "c1", "resume")).toMatchObject({ status: "scheduled" });
    expect(updates.at(-1)).toMatchObject({ resetBatch: true, status: "scheduled" });
    expect(updates.at(-1)).not.toHaveProperty("batchStartAt");
    expect(campaignRow.batchStartAt).toBe(4);
  });
});
