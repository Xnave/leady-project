/**
 * Documents auto-invite, the DB side. After a client-source sync (and hourly)
 * `runInvitesForTenant` sends the opener template to each newly stored client,
 * one reminder ~48h later, then hands the client to the advisor as a task.
 *
 * At most one send per stage, even under retries: the contact row is claimed
 * (`sending_*`) before Zernio is called and the result is written after. A
 * claim that never got its result is not resent; it becomes `unknown` and the
 * advisor gets a task. Pure rules live in `./plan`.
 */
import { Prisma } from "@prisma/client";
import { tenantWhatsAppAccount } from "@/lib/campaigns/store";
import { loadInstanceConfig } from "@/lib/capability-instances";
import { insertAgentMessage } from "@/lib/conversations";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { prisma } from "@/lib/db";
import {
  documentConfigFromStored,
  inviteCutoff,
  inviteTestMode,
  isTestLead,
  type DocumentConfig,
} from "@/lib/flow/document-config";
import type { FlowDefinition, TalkStage } from "@/lib/flow/types";
import { listWhatsAppTemplates, sendWhatsAppTemplate } from "@/lib/zernio";
import {
  INVITE_CLAIM_STALE_MS,
  INVITE_OPEN_STATUSES,
  INVITE_REMINDER_AFTER_MS,
  INVITE_SEND_CAP,
  inSendWindow,
  inviteFirstName,
  isStopReply,
  whatsappExternalIdVariants,
} from "./plan";
import { classifySendError } from "./send-result";
import { INVITE_TEMPLATES, fillInviteBody, inviteTemplateParams, type InviteKind } from "./templates";

export const DOCUMENT_INVITES_EVENT = "documents/invites.requested";

export type DocumentInvitesEvent = { name: typeof DOCUMENT_INVITES_EVENT; data: { tenantId: string } };

export function documentInvitesEvent(tenantId: string): DocumentInvitesEvent {
  return { name: DOCUMENT_INVITES_EVENT, data: { tenantId } };
}

export type InviteRunResult = {
  sent: number;
  reminded: number;
  escalated: number;
  unknown: number;
  stopped: number;
  skipped?: string;
};

type InviteChannel = {
  id: string;
  agentId: string;
  agent: { flow: Prisma.JsonValue; flowVersion: number };
};

type InviteContext = {
  tenantId: string;
  config: DocumentConfig;
  cutoff: Date;
  accountId: string;
  channel: InviteChannel;
};

const CONTACT_SELECT = {
  id: true,
  phone: true,
  name: true,
  mapped: true,
  createdAt: true,
  inviteStatus: true,
  leadId: true,
} as const;

type InviteContact = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

function log(msg: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ msg: `documents.invite.${msg}`, ...data }));
}

function documentsOnTalk(flow: unknown): boolean {
  const talk = (flow as FlowDefinition | undefined)?.stages?.talk as TalkStage | undefined;
  return Boolean(talk?.type === "talk" && talk.capabilities?.includes("documents"));
}

/** Everything a run needs, or why this tenant sends nothing now. */
async function loadInviteContext(tenantId: string): Promise<InviteContext | { skipped: string }> {
  const raw = await loadInstanceConfig({ tenantId, capabilityId: "documents" });
  if (!Object.keys(raw).length) return { skipped: "documents_off" };
  let config: DocumentConfig;
  try {
    config = documentConfigFromStored(raw);
  } catch {
    return { skipped: "bad_config" };
  }
  const cutoff = inviteCutoff(config);
  if (!cutoff) return { skipped: "off" };
  if (!config.clientDisplayName) return { skipped: "no_display_name" };
  const account = await tenantWhatsAppAccount(tenantId);
  if (!account) return { skipped: "no_whatsapp" };
  const channel = await prisma.channelConnection.findFirst({
    where: { tenantId, provider: "whatsapp", enabled: true, providerExternalId: account.accountId },
    select: { id: true, agentId: true, agent: { select: { flow: true, flowVersion: true } } },
  });
  if (!channel) return { skipped: "no_whatsapp" };
  if (!documentsOnTalk(channel.agent.flow)) return { skipped: "documents_off" };
  return { tenantId, config, cutoff, accountId: account.accountId, channel };
}

/** Approved invite templates on the tenant's account (a live Meta read). */
export async function approvedInviteTemplates(accountId: string): Promise<Set<InviteKind>> {
  const live = await listWhatsAppTemplates(accountId);
  const approved = new Set<InviteKind>();
  for (const t of Object.values(INVITE_TEMPLATES)) {
    const found = live.find((x) => x.name === t.name && x.language === t.language);
    if (found?.status?.toUpperCase() === "APPROVED") approved.add(t.kind);
  }
  return approved;
}

export type InviteTemplateState = "approved" | "pending" | "rejected" | "missing" | "no_whatsapp" | "error";

/** For the settings screen: each template's review state on the tenant's own number. */
export async function inviteTemplateStates(tenantId: string): Promise<Record<InviteKind, InviteTemplateState>> {
  const account = await tenantWhatsAppAccount(tenantId);
  if (!account) return { opener: "no_whatsapp", reminder: "no_whatsapp" };
  try {
    const live = await listWhatsAppTemplates(account.accountId);
    const state = (kind: InviteKind): InviteTemplateState => {
      const t = INVITE_TEMPLATES[kind];
      const s = live.find((x) => x.name === t.name && x.language === t.language)?.status?.toUpperCase() ?? "";
      if (!s) return "missing";
      if (s === "APPROVED") return "approved";
      if (s === "REJECTED" || s === "DISABLED" || s === "PAUSED") return "rejected";
      return "pending";
    };
    return { opener: state("opener"), reminder: state("reminder") };
  } catch {
    return { opener: "error", reminder: "error" };
  }
}

/** True when either borrower's phone ever sent this tenant a message, on any channel. */
export async function alreadyInConversation(tenantId: string, phones: string[]): Promise<boolean> {
  const ids = phones.filter(Boolean).flatMap((p) => whatsappExternalIdVariants(p.replace(/\D/g, "")));
  if (!ids.length) return false;
  const found = await prisma.message.findFirst({
    where: { tenantId, role: "lead", conversation: { lead: { externalUserId: { in: ids } } } },
    select: { id: true },
  });
  return Boolean(found);
}

function secondPhone(mapped: unknown): string {
  const m = mapped && typeof mapped === "object" ? (mapped as Record<string, unknown>) : {};
  return typeof m.phone_2 === "string" ? m.phone_2 : "";
}

/**
 * The Lead + open Conversation the invite lives in, so the opener shows in the
 * CRM and the client's tap continues this thread (the bot does not introduce
 * itself again). Reuses a Lead with this phone on the channel.
 */
async function ensureInviteThread(
  ctx: InviteContext,
  contact: InviteContact,
): Promise<{ leadId: string; conversationId: string }> {
  const { tenantId, channel } = ctx;
  const ids = whatsappExternalIdVariants(`+${contact.phone}`);
  let lead = await prisma.lead.findFirst({
    where: { tenantId, channelId: channel.id, externalUserId: { in: ids } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        tenantId,
        channelId: channel.id,
        externalUserId: `+${contact.phone}`,
        displayName: contact.name || `+${contact.phone}`,
        fields: { phone: `+${contact.phone}`, ...(contact.name ? { name: contact.name } : {}) },
        adminUnread: false,
      },
      select: { id: true },
    });
  }
  let convo = await prisma.conversation.findFirst({
    where: { tenantId, leadId: lead.id, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!convo) {
    const flow = channel.agent.flow as unknown as FlowDefinition;
    convo = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        channelId: channel.id,
        agentId: channel.agentId,
        status: "open",
        flowState: flow.start,
        flowVersion: channel.agent.flowVersion,
        summary: "",
        lifecycleReason: "documents_invite",
        session: {},
      },
      select: { id: true },
    });
  }
  if (contact.leadId !== lead.id) {
    await prisma.contact.updateMany({ where: { id: contact.id, tenantId }, data: { leadId: lead.id } });
  }
  return { leadId: lead.id, conversationId: convo.id };
}

type TaskReason = "invite_no_start" | "invite_send_unknown";

const TASK_SUMMARY: Record<TaskReason, string> = {
  invite_no_start: "קיבל הזמנה ותזכורת לשלוח מסמכים ועוד לא התחיל. כדאי ליצור קשר.",
  invite_send_unknown: "לא ברור אם הודעת ההזמנה נשלחה. לא נשלח שוב אוטומטית. כדאי לבדוק וליצור קשר.",
};

async function openInviteTask(ctx: InviteContext, contact: InviteContact, reason: TaskReason): Promise<void> {
  const { leadId, conversationId } = await ensureInviteThread(ctx, contact);
  await prisma.hitlTask.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId,
      leadId,
      type: "more_info",
      reason,
      payload: { kind: "documents_invite", contactId: contact.id, summary: TASK_SUMMARY[reason] },
      status: "open",
    },
  });
  await safeRefreshLeadState(ctx.tenantId, leadId);
}

/** Claimed sends whose result never landed: never resent, handed to the advisor. */
async function settleStaleClaims(ctx: InviteContext, now: Date): Promise<number> {
  const stale = await prisma.contact.findMany({
    where: {
      tenantId: ctx.tenantId,
      inviteStatus: { in: ["sending_opener", "sending_reminder"] },
      inviteClaimedAt: { lte: new Date(now.getTime() - INVITE_CLAIM_STALE_MS) },
    },
    select: CONTACT_SELECT,
  });
  let n = 0;
  for (const c of stale) {
    const won = await prisma.contact.updateMany({
      where: { id: c.id, tenantId: ctx.tenantId, inviteStatus: c.inviteStatus },
      data: { inviteStatus: "unknown", inviteStopReason: "stale_claim" },
    });
    if (won.count !== 1) continue;
    await openInviteTask(ctx, c, "invite_send_unknown");
    log("unknown", { tenantId: ctx.tenantId, contactId: c.id, reason: "stale_claim" });
    n++;
  }
  return n;
}

async function escalateSilent(ctx: InviteContext, now: Date): Promise<number> {
  const due = await prisma.contact.findMany({
    where: {
      tenantId: ctx.tenantId,
      inviteStatus: "reminded",
      inviteReminderAt: { lte: new Date(now.getTime() - INVITE_REMINDER_AFTER_MS) },
    },
    select: CONTACT_SELECT,
  });
  let n = 0;
  for (const c of due) {
    const won = await prisma.contact.updateMany({
      where: { id: c.id, tenantId: ctx.tenantId, inviteStatus: "reminded" },
      data: { inviteStatus: "escalated", inviteEscalatedAt: now },
    });
    if (won.count !== 1) continue;
    await openInviteTask(ctx, c, "invite_no_start");
    log("escalated", { tenantId: ctx.tenantId, contactId: c.id });
    n++;
  }
  return n;
}

async function stopContact(ctx: InviteContext, c: InviteContact, prior: string, reason: string): Promise<void> {
  await prisma.contact.updateMany({
    where: { id: c.id, tenantId: ctx.tenantId, inviteStatus: prior },
    data: { inviteStatus: "stopped", inviteStopReason: reason, inviteClaimedAt: null },
  });
  log("stopped", { tenantId: ctx.tenantId, contactId: c.id, reason });
}

type SendOutcome = "sent" | "stopped" | "unknown" | "raced";

/** One template to one contact, at most once per stage. */
async function sendInvite(ctx: InviteContext, c: InviteContact, kind: InviteKind, now: Date): Promise<SendOutcome> {
  const prior = kind === "opener" ? "" : "invited";
  const firstName = inviteFirstName(c);
  if (!firstName) {
    await stopContact(ctx, c, prior, "no_name");
    return "stopped";
  }
  if (await alreadyInConversation(ctx.tenantId, [c.phone, secondPhone(c.mapped)])) {
    await stopContact(ctx, c, prior, "in_conversation");
    return "stopped";
  }
  // Thread first: a failure here leaves the row unclaimed and nothing sent.
  const thread = await ensureInviteThread(ctx, c);
  const claimed = await prisma.contact.updateMany({
    where: { id: c.id, tenantId: ctx.tenantId, inviteStatus: prior },
    data: { inviteStatus: kind === "opener" ? "sending_opener" : "sending_reminder", inviteClaimedAt: now },
  });
  if (claimed.count !== 1) return "raced";

  const template = INVITE_TEMPLATES[kind];
  const params = inviteTemplateParams(firstName, ctx.config.clientDisplayName);
  let opened: { conversationId: string };
  try {
    opened = await sendWhatsAppTemplate({
      accountId: ctx.accountId,
      phone: c.phone,
      template: { name: template.name, language: template.language },
      params,
    });
  } catch (err) {
    const failure = classifySendError(err);
    if (failure.kind === "rejected") {
      await stopContact(ctx, c, kind === "opener" ? "sending_opener" : "sending_reminder", `rejected:${failure.reason}`);
      return "stopped";
    }
    await prisma.contact.updateMany({
      where: { id: c.id, tenantId: ctx.tenantId },
      data: { inviteStatus: "unknown", inviteStopReason: failure.reason },
    });
    await openInviteTask(ctx, c, "invite_send_unknown").catch((e) =>
      log("task_failed", { tenantId: ctx.tenantId, contactId: c.id, error: String(e) }),
    );
    log("unknown", { tenantId: ctx.tenantId, contactId: c.id, kind, reason: failure.reason });
    return "unknown";
  }

  // Sent and paid for. Never throw from here: a retry must not send it again.
  try {
    await prisma.contact.updateMany({
      where: { id: c.id, tenantId: ctx.tenantId },
      data: {
        inviteStatus: kind === "opener" ? "invited" : "reminded",
        ...(kind === "opener" ? { inviteOpenerAt: now } : { inviteReminderAt: now }),
        inviteClaimedAt: null,
        ...(opened.conversationId ? { inviteConversationId: opened.conversationId } : {}),
      },
    });
    await insertAgentMessage(ctx.tenantId, thread.conversationId, fillInviteBody(template, params), {
      providerMessageId: `invite-${kind}-${c.id}`,
      leadId: thread.leadId,
    });
    if (opened.conversationId) {
      const lead = await prisma.lead.findFirst({ where: { id: thread.leadId, tenantId: ctx.tenantId }, select: { fields: true } });
      const fields = (lead?.fields as Record<string, unknown> | null) ?? {};
      await prisma.lead.updateMany({
        where: { id: thread.leadId, tenantId: ctx.tenantId },
        data: { fields: { ...fields, zernioConversationId: opened.conversationId } as Prisma.InputJsonValue },
      });
    }
    await safeRefreshLeadState(ctx.tenantId, thread.leadId);
  } catch (err) {
    log("record_failed", { tenantId: ctx.tenantId, contactId: c.id, kind, error: String(err) });
  }
  log("sent", { tenantId: ctx.tenantId, contactId: c.id, kind });
  return "sent";
}

/** One pass for one tenant. Safe to run any time: every step is guarded by the row's status. */
export async function runInvitesForTenant(tenantId: string, now: Date): Promise<InviteRunResult> {
  const result: InviteRunResult = { sent: 0, reminded: 0, escalated: 0, unknown: 0, stopped: 0 };
  const ctx = await loadInviteContext(tenantId);
  if ("skipped" in ctx) return { ...result, skipped: ctx.skipped };

  result.unknown += await settleStaleClaims(ctx, now);
  result.escalated += await escalateSilent(ctx, now);
  if (!inSendWindow(now)) return { ...result, skipped: "outside_send_hours" };

  let approved: Set<InviteKind>;
  try {
    approved = await approvedInviteTemplates(ctx.accountId);
  } catch (err) {
    log("templates_unavailable", { tenantId, error: String(err) });
    return { ...result, skipped: "templates_unavailable" };
  }

  const base = { tenantId, phoneStatus: "ok", skipped: false, source: { kind: "smartnpv" } };
  const reminders = approved.has("reminder")
    ? await prisma.contact.findMany({
        where: { ...base, inviteStatus: "invited", inviteOpenerAt: { lte: new Date(now.getTime() - INVITE_REMINDER_AFTER_MS) } },
        orderBy: { inviteOpenerAt: "asc" },
        take: INVITE_SEND_CAP,
        select: CONTACT_SELECT,
      })
    : [];
  const openers = approved.has("opener")
    ? (
        await prisma.contact.findMany({
          where: { ...base, inviteStatus: "", createdAt: { gt: ctx.cutoff } },
          orderBy: { createdAt: "asc" },
          take: inviteTestMode(ctx.config) ? 200 : INVITE_SEND_CAP,
          select: CONTACT_SELECT,
        })
      ).filter((c) => !inviteTestMode(ctx.config) || isTestLead({ apiKeyEnc: "x", testPhones: ctx.config.testPhones }, c.phone))
    : [];

  let budget = INVITE_SEND_CAP;
  for (const [kind, list] of [["reminder", reminders], ["opener", openers]] as const) {
    for (const c of list) {
      if (budget <= 0) break;
      const outcome = await sendInvite(ctx, c, kind, now);
      if (outcome === "sent") {
        budget--;
        if (kind === "opener") result.sent++;
        else result.reminded++;
      } else if (outcome === "unknown") {
        budget--;
        result.unknown++;
      } else if (outcome === "stopped") {
        result.stopped++;
      }
    }
  }
  log("run", { tenantId, ...result });
  return result;
}

/**
 * An inbound WhatsApp message from an invited client. A bare stop word stops
 * the invite (the caller skips the bot turn); anything else, including the
 * button tap, marks it started.
 */
export async function recordInviteReply(
  tenantId: string,
  from: string,
  text: string,
  now: Date,
): Promise<"stopped" | "started" | "none"> {
  const digits = from.replace(/\D/g, "");
  if (digits.length < 8) return "none";
  const contact = await prisma.contact.findFirst({
    where: { tenantId, phone: digits, inviteStatus: { in: INVITE_OPEN_STATUSES } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!contact) return "none";
  if (isStopReply(text)) {
    await prisma.contact.updateMany({
      where: { id: contact.id, tenantId },
      data: { inviteStatus: "stopped", inviteStopReason: "client_stop" },
    });
    log("stopped", { tenantId, contactId: contact.id, reason: "client_stop" });
    return "stopped";
  }
  await prisma.contact.updateMany({
    where: { id: contact.id, tenantId },
    data: { inviteStatus: "started", inviteStartedAt: now },
  });
  log("started", { tenantId, contactId: contact.id });
  return "started";
}

export type InviteStats = { invited: number; started: number; waiting: number; handedOff: number; stopped: number };

/** Counts for the settings screen. `invited` = every contact that got an opener. */
export async function inviteStats(tenantId: string): Promise<InviteStats> {
  const groups = await prisma.contact.groupBy({
    by: ["inviteStatus"],
    where: { tenantId, inviteStatus: { not: "" } },
    _count: { _all: true },
  });
  const n = (s: string) => groups.find((g) => g.inviteStatus === s)?._count._all ?? 0;
  const invitedNow = n("invited") + n("reminded") + n("sending_opener") + n("sending_reminder");
  const handedOff = n("escalated") + n("unknown");
  const started = n("started");
  const sentAtLeastOnce = await prisma.contact.count({ where: { tenantId, inviteOpenerAt: { not: null } } });
  return { invited: sentAtLeastOnce, started, waiting: invitedNow, handedOff, stopped: n("stopped") };
}

/** Tenants whose switch is on, for the hourly pass. */
export async function tenantsWithAutoInvite(): Promise<string[]> {
  const rows = await prisma.capabilityInstance.findMany({
    where: { capabilityId: "documents", enabled: true },
    select: { tenantId: true, config: true },
  });
  const ids = rows
    .filter((r) => r.config && typeof r.config === "object" && (r.config as Record<string, unknown>).autoInvite === true)
    .map((r) => r.tenantId);
  return [...new Set(ids)];
}
