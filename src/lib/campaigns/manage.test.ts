import { beforeEach, describe, expect, it, vi } from "vitest";
import { DECLARATION_VERSION } from "./rules";

const campaignRow = {
  id: "c1",
  tenantId: "t1",
  status: "draft",
  scheduledAt: null as Date | null,
  audience: { kind: "leads", leadIds: ["l1"] },
  params: [{ source: "first_name", value: "", fallback: "שלום" }],
  template: { status: "APPROVED", body: "היי {{1}}", category: "MARKETING" },
};
const declarations: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
let enabled = true;

vi.mock("@/lib/db", () => {
  const campaign = {
    findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
      where.id === campaignRow.id && where.tenantId === campaignRow.tenantId ? campaignRow : null,
    updateMany: async (a: { where: { status: string }; data: Record<string, unknown> }) => {
      if (campaignRow.status !== a.where.status) return { count: 0 };
      updates.push(a.data);
      Object.assign(campaignRow, a.data);
      return { count: 1 };
    },
  };
  const ownerDeclaration = { create: async (a: { data: Record<string, unknown> }) => declarations.push(a.data) };
  return {
    prisma: {
      campaign,
      ownerDeclaration,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ campaign, ownerDeclaration }),
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
}));

const { confirmCampaign } = await import("./manage");
const actor = { actorUserId: "owner@x", actorLabel: "owner@x" };

beforeEach(() => {
  campaignRow.status = "draft";
  declarations.length = 0;
  updates.length = 0;
  enabled = true;
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
});
