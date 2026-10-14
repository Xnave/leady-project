import { beforeEach, describe, expect, it, vi } from "vitest";

type Recipient = {
  id: string;
  tenantId: string;
  clerkUserId: string;
  label: string;
  phone: string;
  optedInAt: Date | null;
  optInCode: string | null;
  optInCodeAt: Date | null;
  conversationId: string;
  lastInboundAt: Date | null;
};

let recipients: Recipient[] = [];
let dueLeads: unknown[] = [];
let sentLog: string[] = [];

const matches = (r: Recipient, where: Record<string, unknown>): boolean => {
  if (where.tenantId && r.tenantId !== where.tenantId) return false;
  if (where.phone && r.phone !== where.phone) return false;
  if (where.optedInAt && r.optedInAt == null) return false;
  const not = where.NOT as { id?: string } | undefined;
  if (not?.id && r.id === not.id) return false;
  return true;
};

const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Recipient> }) => {
  const r = recipients.find((x) => x.id === where.id)!;
  Object.assign(r, data);
  return r;
});

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: {
      findUniqueOrThrow: async () => ({ timezone: "Asia/Jerusalem", name: "Villa Nofim", digestSector: "" }),
    },
    capabilityInstance: { findMany: async () => [{ capabilityId: "reservations", enabled: true }] },
    lead: { findMany: async () => dueLeads },
    digestRecipient: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => recipients.filter((r) => matches(r, where)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => recipients.find((r) => matches(r, where)) ?? null,
      findUnique: async ({ where }: { where: { optInCode: string } }) =>
        recipients.find((r) => r.optInCode === where.optInCode) ?? null,
      update: (a: { where: { id: string }; data: Partial<Recipient> }) => update(a),
    },
    digestLog: {
      findUnique: async () => null,
      create: async () => ({ recipients: [] }),
      update: async ({ data }: { data: { recipients: string[] } }) => {
        sentLog = [...data.recipients];
      },
    },
  },
}));

const sendText = vi.fn(async (_o: { accountId: string; conversationId: string; text: string }) => undefined);
const sendTemplate = vi.fn(async (_o: { phone: string; template: { name: string }; params: string[] }) => ({
  conversationId: "conv-new",
}));
vi.mock("@/lib/zernio", () => ({
  sendZernioInboxMessage: (o: { accountId: string; conversationId: string; text: string }) => sendText(o),
  sendWhatsAppTemplate: (o: { phone: string; template: { name: string }; params: string[] }) => sendTemplate(o),
  listWhatsAppTemplates: async () => [],
}));

const { handleDigestReply, runDigestForTenant } = await import("./digest-send");
const { DIGEST_TEMPLATES, templateKey } = await import("./digest-templates");

const NOW = new Date("2026-10-14T05:00:00Z");
const recipient = (o: Partial<Recipient> = {}): Recipient => ({
  id: "r1",
  tenantId: "t1",
  clerkUserId: "u1",
  label: "Snir",
  phone: "972501234567",
  optedInAt: new Date("2026-10-01T00:00:00Z"),
  optInCode: null,
  optInCodeAt: null,
  conversationId: "",
  lastInboundAt: null,
  ...o,
});
const lead = (name: string) => ({
  id: name,
  displayName: name,
  externalUserId: name,
  fields: {},
  attentionReason: "approval",
  attentionAt: new Date("2026-10-13T10:00:00Z"),
  nextStepText: "",
  conversations: [],
});
const reply = (text: string, o: Partial<{ from: string; signatureVerified: boolean; accountId: string }> = {}) =>
  handleDigestReply({
    accountId: o.accountId ?? "platform",
    conversationId: "conv-1",
    from: o.from ?? "+972 50-123-4567",
    text,
    signatureVerified: o.signatureVerified ?? true,
  });

beforeEach(() => {
  process.env.DIGEST_WHATSAPP_ENABLED = "true";
  process.env.DIGEST_WHATSAPP_ACCOUNT_ID = "platform";
  process.env.DIGEST_TEMPLATE_LANG = "en";
  recipients = [];
  dueLeads = [];
  sentLog = [];
  update.mockClear();
  sendText.mockClear();
  sendTemplate.mockClear();
});

describe("handleDigestReply", () => {
  it("leaves other accounts' messages to the tenant channel", async () => {
    expect(await reply("hi", { accountId: "tenant-wa" })).toBe(false);
  });

  it("refuses an unsigned reply without reading or sending anything", async () => {
    recipients = [recipient()];
    dueLeads = [lead("Dana")];
    expect(await reply("hi", { signatureVerified: false })).toBe(true);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("confirms an opt-in with the phone WhatsApp reports, not a typed one", async () => {
    recipients = [recipient({ phone: "", optedInAt: null, optInCode: "123456", optInCodeAt: new Date(Date.now() - 60_000) })];
    await reply("START 123456");
    expect(recipients[0]).toMatchObject({ phone: "972501234567", optInCode: null, conversationId: "conv-1" });
    expect(recipients[0].optedInAt).not.toBeNull();
    expect(sendText.mock.calls[0][0].text).toContain("daily summary");
  });

  it("rejects an expired code", async () => {
    recipients = [recipient({ phone: "", optedInAt: null, optInCode: "123456", optInCodeAt: new Date(Date.now() - 25 * 3600_000) })];
    await reply("START 123456");
    expect(recipients[0].optedInAt).toBeNull();
    expect(sendText.mock.calls[0][0].text).toContain("expired");
  });

  it("won't connect a phone another business already uses", async () => {
    recipients = [
      recipient({ id: "other", tenantId: "t2", clerkUserId: "u2" }),
      recipient({ phone: "", optedInAt: null, optInCode: "123456", optInCodeAt: new Date() }),
    ];
    await reply("START 123456");
    expect(recipients[1].optedInAt).toBeNull();
    expect(sendText.mock.calls[0][0].text).toContain("another business");
  });

  it("unsubscribes on STOP", async () => {
    recipients = [recipient()];
    await reply("stop");
    expect(recipients[0].optedInAt).toBeNull();
  });

  it("swallows an unknown sender on the platform number", async () => {
    expect(await reply("hello")).toBe(true);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("answers any other message with the full list and records the open window", async () => {
    recipients = [recipient()];
    dueLeads = [lead("Dana")];
    await reply("הצג רשימה מלאה");
    expect(sendText.mock.calls[0][0].text).toContain("Dana");
    expect(recipients[0].lastInboundAt).not.toBeNull();
    expect(recipients[0].conversationId).toBe("conv-1");
  });
});

describe("runDigestForTenant", () => {
  const approved = new Set([templateKey(DIGEST_TEMPLATES.hospitality.name, "he")]);

  it("sends free text when the owner's window is open", async () => {
    recipients = [recipient({ conversationId: "conv-1", lastInboundAt: new Date(NOW.getTime() - 3600_000) })];
    dueLeads = [lead("Dana")];
    expect(await runDigestForTenant("t1", NOW, approved)).toMatchObject({ sent: 1 });
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("sends the sector template when the window is closed", async () => {
    recipients = [recipient()];
    dueLeads = [lead("Dana"), lead("Ori")];
    expect(await runDigestForTenant("t1", NOW, approved)).toMatchObject({ sent: 1 });
    const call = sendTemplate.mock.calls[0][0];
    expect(call.template.name).toBe(DIGEST_TEMPLATES.hospitality.name);
    expect(call.params).toEqual(["Snir", "2", "0", "0", "Dana"]);
    expect(recipients[0].conversationId).toBe("conv-new");
    expect(sentLog).toEqual(["u1"]);
  });

  it("waits, without marking sent, when there is neither a window nor a template", async () => {
    recipients = [recipient()];
    dueLeads = [lead("Dana")];
    expect(await runDigestForTenant("t1", NOW, new Set())).toMatchObject({ sent: 0, waiting: 1 });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(sentLog).toEqual([]);
  });

  it("keeps going when one recipient's send fails", async () => {
    recipients = [recipient(), recipient({ id: "r2", clerkUserId: "u2", phone: "972509999999" })];
    dueLeads = [lead("Dana")];
    sendTemplate.mockRejectedValueOnce(new Error("template paused"));
    expect(await runDigestForTenant("t1", NOW, approved)).toMatchObject({ sent: 1, failed: 1 });
    expect(sentLog).toEqual(["u2"]);
  });
});
