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
  alertsEnabled: true,
  alertApprovals: true,
  alertHandoffs: true,
  quietHoursEnabled: true,
  quietStartHour: 22,
  quietEndHour: 8,
  quietMode: "hold",
};
let tenant: {
  name: string;
  clerkOrgId: string;
  timezone: string;
  digestEnabled: boolean;
  alertSettings: typeof settings | null;
} | null;
let tasks: Task[];
let recipients: Recipient[];
let approved: Set<string>;
let triggerId: string;
const hitlFindMany = vi.fn();
const messageFindFirst = vi.fn();
const recipientUpdate = vi.fn(async (_a: unknown): Promise<unknown> => ({ count: 1 }));

const openTask = (id: string) => tasks.find((t) => t.id === id && t.status === "open") ?? null;

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: {
      findFirst: async ({
        where,
      }: {
        where: { alertSettings?: { is: { alertsEnabled: boolean } }; NOT?: { clerkOrgId: { startsWith: string } } };
      }) =>
        tenant &&
        (!where.alertSettings || tenant.alertSettings?.alertsEnabled === where.alertSettings.is.alertsEnabled) &&
        (!where.NOT || !tenant.clerkOrgId.startsWith(where.NOT.clerkOrgId.startsWith))
          ? tenant
          : null,
    },
    conversation: {
      findFirst: async () => ({ leadId: "lead1", lead: { externalUserId: tasks[0]?.lead.externalUserId ?? "" } }),
    },
    message: {
      findFirst: async () => {
        messageFindFirst();
        return { createdAt: new Date("2026-10-20T08:59:00Z"), providerMessageId: triggerId };
      },
    },
    hitlTask: {
      findMany: async (a: { where: { createdAt: { gte: Date } } }) => {
        hitlFindMany(a);
        return tasks.filter((t) => t.status === "open" && t.createdAt >= a.where.createdAt.gte);
      },
      findFirst: async ({ where }: { where: { id: string } }) => openTask(where.id),
    },
    digestRecipient: {
      findMany: async () => recipients.filter((r) => r.optedInAt),
      findFirst: async ({ where }: { where: { id: string } }) =>
        recipients.find((r) => r.id === where.id && r.optedInAt) ?? null,
      updateMany: (a: unknown) => recipientUpdate(a),
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
  tenant = {
    name: "Villa Nofim",
    clerkOrgId: "org_villa",
    timezone: "Asia/Jerusalem",
    digestEnabled: true,
    alertSettings: { ...settings },
  };
  tasks = [task()];
  recipients = [recipient()];
  approved = new Set();
  triggerId = "wamid.1";
  hitlFindMany.mockClear();
  messageFindFirst.mockClear();
  recipientUpdate.mockClear();
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
    tenant!.alertSettings = { ...settings, alertsEnabled: false };
    expect(await collect()).toEqual([]);
    tenant!.alertSettings = null;
    expect(await collect()).toEqual([]);
    expect(hitlFindMany).not.toHaveBeenCalled();
  });

  it("matches from the caller's anchor when there is no trigger message (HITL resume)", async () => {
    const anchor = new Date("2026-10-20T08:30:00Z");
    await collectOwnerAlertEvents({ tenantId: "t1", conversationId: "c1", since: anchor });
    expect(messageFindFirst).not.toHaveBeenCalled();
    expect(hitlFindMany.mock.calls[0][0].where.createdAt.gte).toEqual(anchor);
  });

  it("skips rapid-demo tenants", async () => {
    tenant!.clerkOrgId = "local-demo-1234";
    expect(await collect()).toEqual([]);
    expect(hitlFindMany).not.toHaveBeenCalled();
  });

  it("skips demo leads", async () => {
    tasks = [task({ lead: { id: "l", displayName: "x", externalUserId: "demo-1", fields: {} } })];
    expect(await collect()).toEqual([]);
  });

  it("skips demo chat turns that post as a real-looking lead", async () => {
    triggerId = "demo-1b2c";
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
    tenant!.alertSettings = { ...settings, alertApprovals: false };
    expect(await ownerAlertRecipients("t1", "task1")).toEqual([]);
  });
});

describe("sendOwnerAlert", () => {
  it("sends free text with a link to the lead inside the 24h window", async () => {
    recipients = [recipient({ conversationId: "conv-1", lastInboundAt: new Date(NOW.getTime() - 3600_000) })];
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW, approved)).toBe("text");
    expect(sendText.mock.calls[0][0].text).toContain("https://app.example/leads/lead1");
    expect(sendText.mock.calls[0][0].text).toContain("Dana");
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("uses the approved template outside the window", async () => {
    approved = new Set(["zapidly_alert_approval_v1:he"]);
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW, approved)).toBe("template");
    expect(sendTemplate.mock.calls[0][0]).toMatchObject({
      phone: "972501234567",
      template: { name: "zapidly_alert_approval_v1" },
      params: ["Villa Nofim", "Dana", "12-14/11"],
    });
  });

  it("picks the handoff template for a handoff", async () => {
    tasks = [task({ type: "more_info", reason: "asked_for_person", payload: { summary: "Wants a group price" } })];
    approved = new Set(["zapidly_alert_handoff_v1:he"]);
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW, approved)).toBe("template");
    expect(sendTemplate.mock.calls[0][0].params[2]).toBe("Wants a group price");
  });

  it("waits when the window is closed and no template is approved", async () => {
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW, approved)).toBe("wait");
    expect(sendText).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it("keeps the template sent when saving the new conversation fails", async () => {
    approved = new Set(["zapidly_alert_approval_v1:he"]);
    recipientUpdate.mockRejectedValueOnce(new Error("deadlock"));
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW, approved)).toBe("template");
    expect(recipientUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "r1", tenantId: "t1" } });
  });

  it("sends nothing to a recipient who opted out meanwhile", async () => {
    recipients = [recipient({ optedInAt: null })];
    expect(await sendOwnerAlert("t1", "task1", "r1", NOW, approved)).toBe("gone");
  });
});
