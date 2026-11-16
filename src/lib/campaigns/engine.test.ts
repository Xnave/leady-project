import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory Prisma with just enough `where` support for the campaign engine.
 * Updates are synchronous, like a single-row conditional UPDATE in Postgres,
 * which is what makes the queued → sending claim race-safe.
 */
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function match(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "NOT") {
      if (match(row, cond as Row)) return false;
      continue;
    }
    if (key === "OR") {
      if (!(cond as Row[]).some((c) => match(row, c))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Row[]).every((c) => match(row, c))) return false;
      continue;
    }
    const v = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(v)) return false;
      if ("not" in c && c.not === null && v == null) return false;
      if ("gte" in c && !(v instanceof Date && v >= (c.gte as Date))) return false;
      if ("lte" in c && !(v instanceof Date && v <= (c.lte as Date))) return false;
      if ("lt" in c && !(v instanceof Date && v < (c.lt as Date))) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function table(name: string) {
  db[name] ??= [];
  const rows = () => db[name];
  return {
    findMany: async (a: { where?: Row; take?: number } = {}) => rows().filter((r) => match(r, a.where)).slice(0, a.take ?? Infinity),
    findFirst: async (a: { where?: Row } = {}) => {
      const r = rows().find((x) => match(x, a.where));
      if (!r) return null;
      if (name === "campaign") {
        return {
          ...r,
          template: db.whatsAppTemplate.find((t) => t.id === r.templateId),
          tenant: db.tenant.find((t) => t.id === r.tenantId),
          declaration: db.ownerDeclaration.find((d) => d.campaignId === r.id) ?? null,
        };
      }
      return r;
    },
    findUnique: async (a: { where: Row }) => rows().find((x) => match(x, a.where)) ?? null,
    count: async (a: { where?: Row } = {}) => rows().filter((r) => match(r, a.where)).length,
    update: async (a: { where: Row; data: Row }) => {
      const r = rows().find((x) => match(x, a.where));
      if (!r) throw new Error(`${name} not found`);
      Object.assign(r, a.data);
      return r;
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      const hit = rows().filter((x) => match(x, a.where));
      hit.forEach((r) => Object.assign(r, a.data));
      return { count: hit.length };
    },
    createMany: async (a: { data: Row[] }) => {
      for (const d of a.data) {
        if (name === "campaignSend" && rows().some((r) => r.campaignId === d.campaignId && r.phone === d.phone)) continue;
        rows().push({ id: `${name}-${rows().length + 1}`, createdAt: new Date(), ...d });
      }
      return { count: a.data.length };
    },
  };
}

vi.mock("@/lib/db", () => ({
  prisma: new Proxy({}, { get: (_t, prop: string) => table(prop) }),
}));

const approvedTemplate = [{ id: "t", name: "promo_1", language: "he", status: "APPROVED", category: "MARKETING" }];
const sendWhatsAppTemplate = vi.fn(async (_o: unknown) => ({ conversationId: "conv-1" }));
const listWhatsAppTemplates = vi.fn(async () => approvedTemplate);
vi.mock("@/lib/zernio", () => ({
  zernioConfigured: () => true,
  sendWhatsAppTemplate: (o: unknown) => sendWhatsAppTemplate(o),
  listWhatsAppTemplates: () => listWhatsAppTemplates(),
}));
vi.mock("./store", () => ({
  tenantWhatsAppAccount: async () => ({ accountId: "acc-1", phone: "972500000000" }),
}));
vi.mock("@/lib/dev-auth-bypass", () => ({ isProductionRuntime: () => true }));

const { prepareCampaignRun, resolveAudience, sendCampaignChunk, freezeAudience } = await import("./engine");
const { prisma } = await import("@/lib/db");

// Thursday 11:00 in Israel: inside sending hours.
const NOW = new Date("2026-11-05T09:00:00Z");

function seed(opts: { declaration?: boolean; phones?: string[] } = {}) {
  for (const k of Object.keys(db)) delete db[k];
  db.tenant = [{ id: "t1", name: "Biz", timezone: "Asia/Jerusalem" }, { id: "t2", name: "Other", timezone: "Asia/Jerusalem" }];
  db.tenantCampaignSettings = [
    { tenantId: "t1", enabled: true, adPrefixEnabled: true, adPrefixOffNote: "", adPrefixOffBy: "", adPrefixOffAt: null, dailySendCeiling: 200, termsVersion: "2026-11-03", termsAcceptedAt: NOW, termsAcceptedBy: "o" },
  ];
  db.whatsAppTemplate = [{ id: "tpl", tenantId: "t1", accountId: "acc-1", name: "promo_1", language: "he", status: "APPROVED", category: "MARKETING", text: "hi {{1}}" }];
  db.campaign = [
    {
      id: "c1",
      tenantId: "t1",
      templateId: "tpl",
      status: "sending",
      scheduledAt: new Date(NOW.getTime() - 60_000),
      batchSize: null,
      batchStartAt: 0,
      materializedAt: NOW,
      audience: { kind: "leads", leadIds: ["x"] },
      params: [],
    },
  ];
  db.ownerDeclaration = opts.declaration === false ? [] : [{ id: "d1", tenantId: "t1", campaignId: "c1" }];
  db.campaignSend = (opts.phones ?? ["972501111111", "972502222222", "972503333333"]).map((phone, i) => ({
    id: `s${i}`,
    tenantId: "t1",
    campaignId: "c1",
    phone,
    name: `N${i}`,
    contactId: null,
    leadId: null,
    status: "queued",
    skipReason: "",
    params: [`N${i}`],
    sentAt: null,
    createdAt: new Date(NOW.getTime() + i),
  }));
  db.suppression = [];
  db.lead = [];
  db.hitlTask = [];
  db.request = [];
}

beforeEach(() => {
  sendWhatsAppTemplate.mockClear();
  listWhatsAppTemplates.mockReset();
  listWhatsAppTemplates.mockImplementation(async () => approvedTemplate);
  seed();
});

describe("sendCampaignChunk", () => {
  it("sends each queued row once from the template's account", async () => {
    const res = await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(res).toMatchObject({ sent: 3, attempted: 3, queuedLeft: 0 });
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(3);
    expect(sendWhatsAppTemplate.mock.calls[0][0]).toMatchObject({ accountId: "acc-1", phone: "972501111111", params: ["N0"] });
    expect(db.campaignSend.every((s) => s.status === "sent" && s.sentAt instanceof Date)).toBe(true);
  });

  it("a retried or overlapping chunk does not send twice", async () => {
    await Promise.all([sendCampaignChunk("t1", "c1", 10, NOW), sendCampaignChunk("t1", "c1", 10, NOW)]);
    await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(3);
    const phones = sendWhatsAppTemplate.mock.calls.map((c) => (c[0] as { phone: string }).phone);
    expect(new Set(phones).size).toBe(3);
  });

  it("never resends a row left in 'sending' by a crash", async () => {
    db.campaignSend[0].status = "sending";
    await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(2);
    expect(db.campaignSend[0].status).toBe("sending");
  });

  it("re-checks suppression and the 7-day cap at send time", async () => {
    db.suppression.push({ tenantId: "t1", phone: "972501111111", reason: "opt_out" });
    db.campaignSend.push({ id: "old", tenantId: "t1", campaignId: "c0", phone: "972502222222", status: "sent", sentAt: new Date(NOW.getTime() - 2 * 86400000) });
    const res = await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(res).toMatchObject({ sent: 1, skipped: 2 });
    expect(db.campaignSend.find((s) => s.id === "s0")).toMatchObject({ status: "skipped", skipReason: "suppressed" });
    expect(db.campaignSend.find((s) => s.id === "s1")).toMatchObject({ status: "skipped", skipReason: "frequency_cap" });
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
  });

  it("records a failed send and moves on", async () => {
    sendWhatsAppTemplate.mockRejectedValueOnce(new Error("Zernio 400: bad number"));
    const res = await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(res).toMatchObject({ sent: 2, failed: 1 });
    expect(db.campaignSend[0]).toMatchObject({ status: "failed", error: "Zernio 400: bad number", sentAt: null });
  });

  it("stops claiming once the campaign is no longer sending", async () => {
    sendWhatsAppTemplate.mockImplementationOnce(async () => {
      db.campaign[0].status = "paused";
      return { conversationId: "conv-1" };
    });
    const res = await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(res.sent).toBe(1);
    expect(db.campaignSend.filter((s) => s.status === "queued")).toHaveLength(2);
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
  });

  it("skips a client archived after the row was queued", async () => {
    db.campaignSend[0].contactId = "contact-archived";
    db.contact = [{ id: "contact-archived", tenantId: "t1", fields: { archive: "1" }, source: { kind: "smartnpv" } }];
    const res = await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(res).toMatchObject({ sent: 2, skipped: 1 });
    expect(db.campaignSend[0]).toMatchObject({ status: "skipped", skipReason: "archived_client" });
  });

  it("a crashed claim does not count as a send for the 7-day cap", async () => {
    db.campaignSend.push({
      id: "stuck",
      tenantId: "t1",
      campaignId: "c0",
      phone: "972501111111",
      status: "sending",
      sentAt: new Date(NOW.getTime() - 60_000),
    });
    const res = await sendCampaignChunk("t1", "c1", 10, NOW);
    expect(res.sent).toBe(3);
    expect(db.campaignSend.find((s) => s.id === "s0")?.status).toBe("sent");
  });

  it("sends nothing outside sending hours or for another tenant", async () => {
    const saturday = new Date("2026-11-07T09:00:00Z");
    expect((await sendCampaignChunk("t1", "c1", 10, saturday)).attempted).toBe(0);
    expect((await sendCampaignChunk("t2", "c1", 10, NOW)).attempted).toBe(0);
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("sends nothing for a paused campaign", async () => {
    db.campaign[0].status = "paused";
    expect((await sendCampaignChunk("t1", "c1", 10, NOW)).attempted).toBe(0);
  });
});

describe("prepareCampaignRun", () => {
  it("refuses and pauses a campaign with no stored declaration", async () => {
    seed({ declaration: false });
    expect(await prepareCampaignRun("t1", "c1", NOW)).toEqual({ go: false, reason: "paused" });
    expect(db.campaign[0]).toMatchObject({ status: "paused", pauseReason: "no_declaration" });
  });

  it("waits in quiet hours without pausing", async () => {
    expect(await prepareCampaignRun("t1", "c1", new Date("2026-11-07T09:00:00Z"))).toEqual({ go: false, reason: "quiet_hours" });
    expect(db.campaign[0].status).toBe("sending");
  });

  it("stops at the daily ceiling", async () => {
    db.tenantCampaignSettings[0].dailySendCeiling = 1;
    db.campaignSend.push({ id: "today", tenantId: "t1", campaignId: "c0", phone: "972509999999", status: "sent", sentAt: NOW });
    expect(await prepareCampaignRun("t1", "c1", NOW)).toEqual({ go: false, reason: "daily_ceiling" });
  });

  it("pauses when the batch is used up", async () => {
    db.campaign[0].batchSize = 2;
    db.campaignSend[0].status = "sent";
    db.campaignSend[1].status = "sent";
    expect(await prepareCampaignRun("t1", "c1", NOW)).toEqual({ go: false, reason: "paused" });
    expect(db.campaign[0].pauseReason).toBe("batch_done");
  });

  it("does not run another tenant's campaign", async () => {
    expect(await prepareCampaignRun("t2", "c1", NOW)).toEqual({ go: false, reason: "gone" });
  });

  it("goes with a budget when everything checks out", async () => {
    expect(await prepareCampaignRun("t1", "c1", NOW)).toEqual({ go: true, budget: 200 });
  });

  it("samples the batch cursor when resume asked, and leaves a fresh cursor alone", async () => {
    db.campaign[0].resetBatch = true;
    db.campaign[0].batchStartAt = 0;
    db.campaign[0].batchSize = 10;
    db.campaignSend[0].status = "sent";
    expect(await prepareCampaignRun("t1", "c1", NOW)).toEqual({ go: true, budget: 10 });
    expect(db.campaign[0]).toMatchObject({ batchStartAt: 1, resetBatch: false });
  });

  it("requeues a send stuck in sending and leaves a fresh one", async () => {
    db.campaignSend[0].status = "sending";
    db.campaignSend[0].updatedAt = new Date(NOW.getTime() - 16 * 60 * 1000);
    db.campaignSend[1].status = "sending";
    db.campaignSend[1].updatedAt = NOW;
    expect(await prepareCampaignRun("t1", "c1", NOW)).toEqual({ go: true, budget: 200 });
    expect(db.campaignSend[0].status).toBe("queued");
    expect(db.campaignSend[1].status).toBe("sending");
  });

  it("does not move a canceled campaign back to sending", async () => {
    listWhatsAppTemplates.mockImplementationOnce(async () => {
      db.campaign[0].status = "canceled";
      return approvedTemplate;
    });
    expect(await prepareCampaignRun("t1", "c1", NOW)).toEqual({ go: false, reason: "not_runnable" });
    expect(db.campaign[0].status).toBe("canceled");
  });
});

describe("resolveAudience leads", () => {
  it("uses a phone field when the channel is not WhatsApp, and skips a lead with none", async () => {
    db.lead = [
      { id: "wa", tenantId: "t1", externalUserId: "972509999999", displayName: "Wa", fields: { phone: "0501111111" }, channel: { provider: "whatsapp" } },
      { id: "ig", tenantId: "t1", externalUserId: "ig-user", displayName: "Dana", fields: { phone: "0501234567" }, channel: { provider: "instagram" } },
      { id: "none", tenantId: "t1", externalUserId: "x", displayName: "No", fields: {}, channel: { provider: "instagram" } },
    ];
    const rows = await resolveAudience("t1", { kind: "leads", leadIds: ["wa", "ig", "none"] }, NOW);
    expect(rows).not.toBe("audience_too_large");
    if (rows === "audience_too_large") return;
    expect(rows.find((r) => r.leadId === "wa")).toMatchObject({ phone: "972509999999", phoneStatus: "ok" });
    expect(rows.find((r) => r.leadId === "ig")).toMatchObject({ phone: "972501234567", phoneStatus: "ok" });
    expect(rows.find((r) => r.leadId === "none")).toMatchObject({ phone: "", phoneStatus: "missing" });
  });

  it("leaves out a lead already on the campaign", async () => {
    db.lead = [
      { id: "wa", tenantId: "t1", externalUserId: "972509999999", displayName: "Wa", fields: {}, channel: { provider: "whatsapp" } },
      { id: "ig", tenantId: "t1", externalUserId: "ig-user", displayName: "Dana", fields: { phone: "0501234567" }, channel: { provider: "instagram" } },
    ];
    db.campaignSend = [{ id: "old", tenantId: "t1", campaignId: "c1", leadId: "ig", contactId: null, phone: "972501234567", status: "sent" }];
    const rows = await resolveAudience("t1", { kind: "leads", leadIds: ["wa", "ig"] }, NOW, "c1");
    expect(rows).not.toBe("audience_too_large");
    if (rows === "audience_too_large") return;
    expect(rows.map((r) => r.leadId)).toEqual(["wa"]);
  });
});

describe("freezeAudience", () => {
  const campaign = {
    id: "c1",
    tenantId: "t1",
    audience: { kind: "clients" as const, startedYearsAgoMin: null, startedYearsAgoMax: null, confidence: [], includeNoStartedAt: false },
    params: [],
    template: { category: "MARKETING" },
    tenant: { name: "Biz" },
  };

  function contact(i: number, patch: Record<string, unknown> = {}) {
    return {
      id: `contact-${i}`,
      tenantId: "t1",
      phone: `9725${String(i).padStart(8, "0")}`,
      phoneStatus: "ok",
      name: `N${i}`,
      leadId: null,
      fields: {},
      skipped: false,
      startedAt: NOW,
      source: { kind: "smartnpv" },
      ...patch,
    };
  }

  it("writes structural skips only and leaves time-varying skips queued", async () => {
    db.campaignSend = [];
    db.contact = [
      contact(1, { phone: "", phoneStatus: "missing", name: "No Phone" }),
      contact(2, { id: "kept", phone: "972501111111", fields: { archive: "1" }, name: "Dana" }),
    ];
    expect(await freezeAudience(prisma as never, campaign, NOW)).toBeNull();
    expect(db.campaignSend).toEqual([
      expect.objectContaining({ phone: "972501111111", status: "queued", skipReason: "", contactId: "kept" }),
      expect.objectContaining({ phone: "none:contact-1", status: "skipped", skipReason: "no_phone" }),
    ]);
  });

  it("does not count clients already on the campaign toward the audience", async () => {
    db.campaignSend = [];
    db.contact = [contact(1), contact(2), contact(3)];
    db.campaignSend = [
      { id: "old-1", tenantId: "t1", campaignId: "c1", contactId: "contact-1", phone: "972500000001", status: "sent" },
      { id: "old-2", tenantId: "t1", campaignId: "c1", contactId: "contact-2", phone: "972500000002", status: "queued" },
    ];
    const rows = await resolveAudience(
      "t1",
      { kind: "clients", startedYearsAgoMin: null, startedYearsAgoMax: null, confidence: [], includeNoStartedAt: false },
      NOW,
      "c1",
    );
    expect(rows).not.toBe("audience_too_large");
    if (rows === "audience_too_large") return;
    expect(rows.map((r) => r.contactId)).toEqual(["contact-3"]);
  });

  it("does not queue a second row when a sent recipient is frozen again", async () => {
    db.campaignSend = [];
    db.contact = [contact(2, { id: "kept", phone: "972501111111", name: "Dana" })];
    expect(await freezeAudience(prisma as never, campaign, NOW)).toBeNull();
    const row = db.campaignSend.find((s) => s.phone === "972501111111");
    expect(row?.status).toBe("queued");
    row!.status = "sent";
    expect(await freezeAudience(prisma as never, campaign, NOW)).toBeNull();
    expect(db.campaignSend.filter((s) => s.phone === "972501111111")).toEqual([expect.objectContaining({ status: "sent" })]);
  });

  it("refuses an audience over the cap and writes nothing", async () => {
    db.campaignSend = [];
    db.contact = Array.from({ length: 20_001 }, (_, i) => contact(i));
    expect(await freezeAudience(prisma as never, campaign, NOW)).toBe("audience_too_large");
    expect(db.campaignSend).toHaveLength(0);
  });
});
