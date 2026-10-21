/**
 * Sends instant owner alerts (see `./alerts`). A turn that opens an approval
 * or handoff task returns one `crm/owner-alert.requested` event per task;
 * the `owner-alert` Inngest function plans it (off hours may hold it), then
 * re-checks and sends to each opted-in digest recipient. Everything here is a
 * no-op unless `digestFeatureOn()`, since alerts ride the digest's platform
 * number and opt-ins.
 */
import { prisma } from "@/lib/db";
import { leadDisplayName } from "@/lib/leads";
import { RAPID_DEMO_CLERK_ORG_PREFIX } from "@/lib/rapid-demo/guards";
import { uiCopy } from "@/lib/ui";
import { tasksOpenedThisTurn } from "@/lib/turn-tasks";
import { sendWhatsAppTemplate, sendZernioInboxMessage } from "@/lib/zernio";
import {
  ALERT_TEMPLATES,
  DEFAULT_ALERT_SETTINGS,
  alertDetail,
  alertKind,
  alertTemplateParams,
  alertTemplateText,
  planAlert,
  type AlertPlan,
  type AlertSettings,
} from "./alerts";
import { digestDelivery, serviceWindowOpen } from "./digest";
import { digestAccountId } from "./digest-send";
import { templateKey } from "./digest-templates";
import { digestFeatureOn } from "./flags";

const env = (k: string, d = "") => process.env[k] ?? d;

export type OwnerAlertEvent = {
  name: "crm/owner-alert.requested";
  id: string;
  data: { tenantId: string; taskId: string };
};

const ALERT_SETTINGS = {
  alertsEnabled: true,
  alertApprovals: true,
  alertHandoffs: true,
  quietHoursEnabled: true,
  quietStartHour: true,
  quietEndHour: true,
  quietMode: true,
} as const;

/** The tenant's alert settings (defaults when it never saved any), timezone and digest switch. */
async function loadAlertSettings(
  tenantId: string,
): Promise<(AlertSettings & { timezone: string; digestEnabled: boolean }) | null> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: { timezone: true, digestEnabled: true, alertSettings: { select: ALERT_SETTINGS } },
  });
  if (!tenant) return null;
  const { alertSettings, ...rest } = tenant;
  return { ...DEFAULT_ALERT_SETTINGS, ...alertSettings, ...rest };
}

/**
 * After a turn: one event per open task the turn opened for this lead (see
 * `tasksOpenedThisTurn`); the event id keeps a task from alerting twice.
 * Demo chat turns, demo leads and rapid-demo tenants never alert.
 */
export async function collectOwnerAlertEvents(o: {
  tenantId: string;
  conversationId: string;
  triggerMessageId?: string;
  since: Date;
}): Promise<OwnerAlertEvent[]> {
  if (!digestFeatureOn()) return [];
  try {
    const tenant = await prisma.tenant.findFirst({
      where: {
        id: o.tenantId,
        alertSettings: { is: { alertsEnabled: true } },
        NOT: { clerkOrgId: { startsWith: RAPID_DEMO_CLERK_ORG_PREFIX } },
      },
      select: { id: true },
    });
    if (!tenant) return [];
    const convo = await prisma.conversation.findFirst({
      where: { id: o.conversationId, tenantId: o.tenantId },
      select: { leadId: true, lead: { select: { externalUserId: true } } },
    });
    if (!convo || convo.lead.externalUserId.startsWith("demo-")) return [];
    const { trigger, tasks } = await tasksOpenedThisTurn({ ...o, leadId: convo.leadId });
    // The demo chat can post as any `from` or an existing lead; its messages are always `demo-`.
    if (trigger?.providerMessageId.startsWith("demo-")) return [];
    return tasks.map((t) => ({
      name: "crm/owner-alert.requested",
      id: `owner-alert-${t.id}`,
      data: { tenantId: o.tenantId, taskId: t.id },
    }));
  } catch (err) {
    // An alert is a nicety on top of the turn; never fail the turn over it.
    console.warn(JSON.stringify({ msg: "owner_alert.collect_failed", tenantId: o.tenantId, error: String(err) }));
    return [];
  }
}

/** Whether and when this task's alert goes out, from the tenant's current settings. */
export async function planOwnerAlert(tenantId: string, taskId: string, now: Date): Promise<AlertPlan> {
  if (!digestFeatureOn()) return { send: false, reason: "disabled" };
  const [settings, task] = await Promise.all([
    loadAlertSettings(tenantId),
    prisma.hitlTask.findFirst({ where: { id: taskId, tenantId, status: "open" }, select: { type: true } }),
  ]);
  if (!settings || !task) return { send: false, reason: "disabled" };
  return planAlert(settings, alertKind(task.type), now, settings.timezone, settings.digestEnabled);
}

/**
 * Recipient ids to alert now. Re-checked after any off-hours wait: an owner
 * who handled the task in the app, or switched alerts off, gets nothing.
 */
export async function ownerAlertRecipients(tenantId: string, taskId: string): Promise<string[]> {
  if (!digestFeatureOn()) return [];
  const [settings, task] = await Promise.all([
    loadAlertSettings(tenantId),
    prisma.hitlTask.findFirst({ where: { id: taskId, tenantId, status: "open" }, select: { type: true } }),
  ]);
  if (!settings || !task) return [];
  const kind = alertKind(task.type);
  if (!settings.alertsEnabled || (kind === "approval" ? !settings.alertApprovals : !settings.alertHandoffs)) return [];
  const recipients = await prisma.digestRecipient.findMany({
    where: { tenantId, optedInAt: { not: null } },
    select: { id: true },
  });
  return recipients.map((r) => r.id);
}

/**
 * One recipient's alert: free text when their 24h window is open, else the
 * kind's approved template, else nothing (the lead is still in the next
 * digest and in the full list the owner gets by writing to the number).
 * `approvedTemplates` is loaded once per alert by the caller (a live Meta read).
 */
export async function sendOwnerAlert(
  tenantId: string,
  taskId: string,
  recipientId: string,
  now: Date,
  approvedTemplates: ReadonlySet<string>,
): Promise<"text" | "template" | "wait" | "gone"> {
  const accountId = await digestAccountId();
  const [tenant, task, r] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
    prisma.hitlTask.findFirst({
      where: { id: taskId, tenantId, status: "open" },
      select: {
        type: true,
        reason: true,
        payload: true,
        lead: { select: { id: true, displayName: true, externalUserId: true, fields: true } },
      },
    }),
    prisma.digestRecipient.findFirst({ where: { id: recipientId, tenantId, optedInAt: { not: null } } }),
  ]);
  if (!tenant || !task || !r || !accountId) return "gone";

  const kind = alertKind(task.type);
  const params = alertTemplateParams(
    tenant.name,
    leadDisplayName(task.lead),
    alertDetail(kind, task, uiCopy("he").inbox.reasons),
  );
  const windowOpen = serviceWindowOpen(r.lastInboundAt, now);
  const template = ALERT_TEMPLATES[kind];
  const hasTemplate = approvedTemplates.has(templateKey(template.name, template.language));
  const how = digestDelivery({ windowOpen, hasConversation: Boolean(r.conversationId), hasTemplate });

  if (how === "text") {
    await sendZernioInboxMessage({
      accountId,
      conversationId: r.conversationId,
      text: alertTemplateText(kind, params, env("NEXT_PUBLIC_APP_URL"), task.lead.id),
    });
  } else if (how === "template") {
    const opened = await sendWhatsAppTemplate({
      accountId,
      phone: r.phone,
      template: { name: template.name, language: template.language },
      params,
    });
    if (opened.conversationId && opened.conversationId !== r.conversationId) {
      // Best-effort: throwing here would retry the step and re-send the paid template.
      await prisma.digestRecipient
        .updateMany({ where: { id: r.id, tenantId }, data: { conversationId: opened.conversationId } })
        .catch((err) =>
          console.warn(JSON.stringify({ msg: "owner_alert.conversation_save_failed", tenantId, recipientId, error: String(err) })),
        );
    }
  }
  const msg = how === "text" || how === "template" ? "owner_alert.sent" : "owner_alert.skipped";
  console.log(JSON.stringify({ msg, tenantId, taskId, recipientId, kind, how }));
  return how;
}
