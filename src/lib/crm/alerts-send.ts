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
import { sendWhatsAppTemplate, sendZernioInboxMessage } from "@/lib/zernio";
import {
  ALERT_TEMPLATES,
  alertDetail,
  alertKind,
  alertTemplateParams,
  alertTemplateText,
  planAlert,
  type AlertPlan,
} from "./alerts";
import { digestDelivery, serviceWindowOpen } from "./digest";
import { digestAccountId, loadApprovedDigestTemplates } from "./digest-send";
import { templateKey } from "./digest-templates";
import { digestFeatureOn } from "./flags";

const env = (k: string, d = "") => process.env[k] ?? d;

export type OwnerAlertEvent = {
  name: "crm/owner-alert.requested";
  id: string;
  data: { tenantId: string; taskId: string };
};

const ALERT_SETTINGS = {
  timezone: true,
  alertsEnabled: true,
  alertApprovals: true,
  alertHandoffs: true,
  quietHoursEnabled: true,
  quietStartHour: true,
  quietEndHour: true,
  quietMode: true,
} as const;

/**
 * After a turn: one event per open task the turn opened for this lead.
 * Tasks are matched from the trigger message's time, not the worker's start,
 * so a retried turn still finds what its first attempt created; the event id
 * keeps a task from alerting twice. Demo leads and rapid-demo tenants never alert.
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
      where: { id: o.tenantId, alertsEnabled: true, NOT: { clerkOrgId: { startsWith: RAPID_DEMO_CLERK_ORG_PREFIX } } },
      select: { id: true },
    });
    if (!tenant) return [];
    const convo = await prisma.conversation.findFirst({
      where: { id: o.conversationId, tenantId: o.tenantId },
      select: { leadId: true },
    });
    if (!convo) return [];
    let since = o.since;
    if (o.triggerMessageId) {
      const trigger = await prisma.message.findFirst({
        where: { id: o.triggerMessageId, tenantId: o.tenantId },
        select: { createdAt: true },
      });
      if (trigger) since = trigger.createdAt;
    }
    const tasks = await prisma.hitlTask.findMany({
      where: {
        tenantId: o.tenantId,
        leadId: convo.leadId,
        status: "open",
        createdAt: { gte: since },
        lead: { NOT: { externalUserId: { startsWith: "demo-" } } },
      },
      select: { id: true },
    });
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
  const [tenant, task] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: ALERT_SETTINGS }),
    prisma.hitlTask.findFirst({ where: { id: taskId, tenantId, status: "open" }, select: { type: true } }),
  ]);
  if (!tenant || !task) return { send: false, reason: "disabled" };
  return planAlert(tenant, alertKind(task.type), now, tenant.timezone);
}

/**
 * Recipient ids to alert now. Re-checked after any off-hours wait: an owner
 * who handled the task in the app, or switched alerts off, gets nothing.
 */
export async function ownerAlertRecipients(tenantId: string, taskId: string): Promise<string[]> {
  if (!digestFeatureOn()) return [];
  const [tenant, task] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: ALERT_SETTINGS }),
    prisma.hitlTask.findFirst({ where: { id: taskId, tenantId, status: "open" }, select: { type: true } }),
  ]);
  if (!tenant || !task) return [];
  const kind = alertKind(task.type);
  if (!tenant.alertsEnabled || (kind === "approval" ? !tenant.alertApprovals : !tenant.alertHandoffs)) return [];
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
 */
export async function sendOwnerAlert(
  tenantId: string,
  taskId: string,
  recipientId: string,
  now: Date,
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
  const canText = windowOpen && Boolean(r.conversationId);
  // The template list is a live Meta read; skip it when free text will do.
  const hasTemplate =
    !canText && new Set(await loadApprovedDigestTemplates()).has(templateKey(template.name, template.language));
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
      await prisma.digestRecipient.update({ where: { id: r.id }, data: { conversationId: opened.conversationId } });
    }
  }
  console.log(JSON.stringify({ msg: "owner_alert.sent", tenantId, taskId, recipientId, kind, how }));
  return how;
}
