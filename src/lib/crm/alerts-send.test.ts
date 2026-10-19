import { beforeEach, describe, expect, it, vi } from "vitest";

type Task = {
  id: string;
  type: string;
  reason: string;
  status: string;
  payload: unknown;
  createdAt: Date;
  lead: { id: string; displayName: string; externalUserId: string; fields: unknown };
};
type Recipient = { id: string; phone: string; optedInAt: Date | null; conversationId: string; lastInboundAt: Date | null };

const settings = {
  timezone: "Asia/Jerusalem",
  alertsEnabled: true,
  alertApprovals: true,
  alertHandoffs: true,
  quietHoursEnabled: true,
  quietStartHour: 22,
  quietEndHour: 8,
  quietMode: "hold",
};
let tenant: (typeof settings & { name: string }) | null;
let tasks: Task[];
let recipients: Recipient[];
let approved: { name: string; language: string; status: string }[];
const hitlFindMany = vi.fn();

const openTask = (id: string) => tasks.find((t) => t.id === id && t.status === "open") ?? null;

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: {
      findFirst: async ({ where }: { where: { alertsEnabled?: boolean } }) =>
        tenant && (where.alertsEnabled === undefined || tenant.alertsEnabled === where.alertsEnabled) ? tenant : null,
    },
    conversation: { findFirst: async () => ({ leadId: "lead1" }) },
    message: { findFirst: async () => ({ createdAt: new Date("2026-10-20T08:59:00Z") }) },
    hitlTask: {
      findMany: async (a: { where: { createdAt: { gte: Date }; lead: unknown } }) => {
        hitlFindMany(a);
        return tasks
          .filter((t) => t.status === "open" && t.createdAt >= a.where.createdAt.gte)
          .filter((t) => !t.lead.externalUserId.startsWith("demo-"));
      },
      findFirst: async ({ where }: { where: { id: string } }) => openTask(where.id),
    },
    digestRecipient: {
      findMany: async () => recipients.filter((r) => r.optedInAt),
      findFirst: async ({ where }: { where: { id: string } }) =>
        recipients.find((r) => r.id === where.id && r.optedInAt) ?? null,
      update: async () => undefined,
    },
  },
}));

const sendText = vi.fn(async (_o: { conversationId: string; text: string }) => undefined);
const sendTemplate = vi.fn(async (_o: { phone: string; template: { name: string }; params: string[] }) => ({
  conversationId: "conv-new",
}));
vi.mock("@/lib/zernio", () => ({
  sendZernioInboxMessage: (o: { conversationId: string; text: string }) => sendText(o),
  sendWhatsAppTemplate: (o: { phone: string; template: { name: string }; params: string[] }) => sendTemplate(o),
  listWhatsAppTemplates: async () => approved,
}));

const { collectOwnerAlertEvents, ownerAlertRecipients, planOwnerAlert, sendOwnerAlert } = await import("./alerts-send");

const NOW = new Date("2026-10-20T09:00:00Z"); // 12:00 in Jerusalem
const task = (o: Partial<Task> = {}): Task => ({
  id: "task1",
  type: "request_approval",
  reason: "request_approval",
  status: "open",
  payload: { timeText: "12-14/11" },
  createdAt: NOW,
  lead: { id: "lead1", displayName: "Dana", externalUserId: "972500000000", fields: {} },
  ...o,
});
const recipient = (o: Partial<Recipient> = {}): Recipient => ({
  id: "r1",
  phone: "972501234567",
  optedInAt: new Date("2026-10-01T00:00:00Z"),
  conversationId: "",
  lastInboundAt: null,
  ...o,
});

beforeEach(() => {
  process.env.DIGEST_WHATSAPP_ENABLED = "true";
  process.env.DIGEST_WHATSAPP_ACCOUNT_ID = "platform";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  tenant = { ...settings, name: "Villa Nofim" };
  tasks = [task()];
  recipients = [recipient()];
  approved = [];
  hitlFindMany.mockClear();
  sendText.mockClear();
  sendTemplate.mockClear();
});

describe("collectOwnerAlertEvents", () => {
  const collect = () =>
    collectOwnerAlertEvents({ tenantId: "t1", conversationId: "c1", triggerMessageId: "m1", since: NOW });

  it("returns one idempotent event per task the turn opened", async () => {
    expect(await collect()).toEqual([
      { name: "crm/owner-alert.requested", id: "owner-alert-task1", data: { tenantId: "t1", taskId: "task1" } },
    ]);
  });

  it("matches from the trigger message time, so a retried turn still finds its tasks", async () => {
    await collect();
    expect(hitlFindMany.mock.calls[0][0].where.createdAt.gte).toEqual(new Date("2026-10-20T08:59:00Z"));
  });

  it("does nothing when the feature flag or the tenant switch is off", async () => {
    process.env.DIGEST_WHATSAPP_ENABLED = "false";
    expect(await collect()).toEqual([]);
    process.env.DIGEST_WHATSAPP_ENABLED = "true";
    tenant = { ...settings, name: "Villa Nofim", alertsEnabled: false };
    expect(await collect()).toEqual([]);
    expect(hitlFindMany).not.toHaveBeenCalled();
  });

  it("skips demo leads", async () => {
    tasks = [task({ lead: { id: "l", displayName: "x", externalUserId: "demo-1", fields: {} } })];
    expect(await collect()).toEqual([]);
  });
});

describe("planOwnerAlert / ownerAlertRecipients", () => {
  it("skips a task the owner already handled", async () => {
    tasks = [task({ status: "done" })];
    expect(await planOwnerAlert("t1", "task1", NOW)).toEqual({ send: false, reason: "disabled" });
    expect(await ownerAlertRecipients("t1", "task1")).toEqual([]);
  });

  it("holds a night-time alert until off hours end", async () => {
    expect(await planOwnerAlert("t1", "task1", new Date("2026-10-20T20:30:00Z"))).toEqual({
      send: true,
      at: new Date("2026-10-21T05:00:00Z"),
    });
  });

  it("re-reads the switches after the wait", async () => {
    expect(await ownerAlertRecipients("t1", "task1")).toEqual(["r1"]);
    tenant = { ...settings, name: "Villa Nofim", alertApprovals: false };
    expect(await ownerAlertRecipients("t1", "task1")).toEqual([]);
  });
});

describe("sendOwnerAlert", () => {
  it("sends free text with a link to the lead inside the 24h window", async () => {
    recipients = [recipient({ conversationId: "conv-1", lastInboundAt: new Date(NOW.getTime() - 3600_000) })];
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW)).toBe("text");
    expect(sendText.mock.calls[0][0].text).toContain("https://app.example/leads/lead1");
    expect(sendText.mock.calls[0][0].text).toContain("Dana");
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("uses the approved template outside the window", async () => {
    approved = [{ name: "zapidly_alert_approval_v1", language: "he", status: "APPROVED" }];
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW)).toBe("template");
    expect(sendTemplate.mock.calls[0][0]).toMatchObject({
      phone: "972501234567",
      template: { name: "zapidly_alert_approval_v1" },
      params: ["Villa Nofim", "Dana", "12-14/11"],
    });
  });

  it("picks the handoff template for a handoff", async () => {
    tasks = [task({ type: "more_info", reason: "asked_for_person", payload: { summary: "Wants a group price" } })];
    approved = [{ name: "zapidly_alert_handoff_v1", language: "he", status: "APPROVED" }];
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW)).toBe("template");
    expect(sendTemplate.mock.calls[0][0].params[2]).toBe("Wants a group price");
  });

  it("waits when the window is closed and no template is approved", async () => {
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW)).toBe("wait");
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("sends nothing to a recipient who opted out meanwhile", async () => {
    recipients = [recipient({ optedInAt: null })];
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW)).toBe("gone");
  });
});
