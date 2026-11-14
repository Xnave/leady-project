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
import { normalizeClientPhone } from "@/lib/client-sources/phone";
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
  planInviteStep,
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

const TEMPLATE_READ_TIMEOUT_MS = 4000;

export type InviteTemplateState = "approved" | "pending" | "rejected" | "missing" | "no_whatsapp" | "error";

/** For the settings screen: each template's review state on the tenant's own number. */
export async function inviteTemplateStates(tenantId: string): Promise<Record<InviteKind, InviteTemplateState>> {
  const account = await tenantWhatsAppAccount(tenantId);
  if (!account) return { opener: "no_whatsapp", reminder: "no_whatsapp" };
  try {
    // The settings page waits on this; a slow Meta read must not hang it.
    const live = await Promise.race([
      listWhatsAppTemplates(account.accountId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TEMPLATE_READ_TIMEOUT_MS)),
    ]);
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
  const ids = phones
    .map((p) => normalizeClientPhone(p, "972"))
    .filter((p) => p.status === "ok")
    .flatMap((p) => whatsappExternalIdVariants(p.phone));
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

const INVITE_SELECT = {
  id: true,
  status: true,
  claimedAt: true,
  openerAt: true,
  reminderAt: true,
  contact: { select: CONTACT_SELECT },
} as const;

/** Move an invite row from one status to another. False when another run got there first. */
async function moveInvite(
  tenantId: string,
  inviteId: string,
  from: string,
  data: Prisma.ContactInviteUpdateManyMutationInput,
): Promise<boolean> {
  const won = await prisma.contactInvite.updateMany({ where: { id: inviteId, tenantId, status: from }, data });
  return won.count === 1;
}

/** Claimed sends whose result never landed: never resent, handed to the advisor. */
async function settleStaleClaims(ctx: InviteContext, now: Date): Promise<number> {
  const rows = await prisma.contactInvite.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: ["sending_opener", "sending_reminder"] },
      claimedAt: { lte: new Date(now.getTime() - INVITE_CLAIM_STALE_MS) },
    },
    select: INVITE_SELECT,
  });
  let n = 0;
  for (const row of rows) {
    if (planInviteStep(row, now) !== "unknown") continue;
    if (!(await moveInvite(ctx.tenantId, row.id, row.status, { status: "unknown", stopReason: "stale_claim" }))) continue;
    await openInviteTask(ctx, row.contact, "invite_send_unknown");
    log("unknown", { tenantId: ctx.tenantId, contactId: row.contact.id, reason: "stale_claim" });
    n++;
  }
  return n;
}

async function escalateSilent(ctx: InviteContext, now: Date): Promise<number> {
  const rows = await prisma.contactInvite.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: "reminded",
      reminderAt: { lte: new Date(now.getTime() - INVITE_REMINDER_AFTER_MS) },
    },
    select: INVITE_SELECT,
  });
  let n = 0;
  for (const row of rows) {
    if (planInviteStep(row, now) !== "escalate") continue;
    if (!(await moveInvite(ctx.tenantId, row.id, "reminded", { status: "escalated", escalatedAt: now }))) continue;
    await openInviteTask(ctx, row.contact, "invite_no_start");
    log("escalated", { tenantId: ctx.tenantId, contactId: row.contact.id });
    n++;
  }
  return n;
}

/** Claim a send. The opener claim creates the row, so the unique contactId is the "once" guarantee. */
async function claimSend(
  ctx: InviteContext,
  c: InviteContact,
  kind: InviteKind,
  inviteId: string | null,
  now: Date,
): Promise<string | null> {
  if (kind === "reminder") {
    if (!inviteId) return null;
    return (await moveInvite(ctx.tenantId, inviteId, "invited", { status: "sending_reminder", claimedAt: now })) ? inviteId : null;
  }
  try {
    const row = await prisma.contactInvite.create({
      data: { tenantId: ctx.tenantId, contactId: c.id, status: "sending_opener", claimedAt: now },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

/** Record a contact we will not message, so it is not picked again every hour. */
async function stopBeforeSend(ctx: InviteContext, c: InviteContact, inviteId: string | null, reason: string): Promise<void> {
  if (inviteId) {
    await moveInvite(ctx.tenantId, inviteId, "invited", { status: "stopped", stopReason: reason });
  } else {
    await prisma.contactInvite
      .create({ data: { tenantId: ctx.tenantId, contactId: c.id, status: "stopped", stopReason: reason } })
      .catch((err) => {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      });
  }
  log("stopped", { tenantId: ctx.tenantId, contactId: c.id, reason });
}

type SendOutcome = "sent" | "stopped" | "unknown" | "raced" | "blocked";

/** Another contact with this phone already has an invite (two CRM rows for one client). */
async function phoneAlreadyInvited(tenantId: string, c: InviteContact): Promise<boolean> {
  const found = await prisma.contactInvite.findFirst({
    where: { tenantId, contactId: { not: c.id }, contact: { phone: c.phone } },
    select: { id: true },
  });
  return Boolean(found);
}

/** One template to one contact, at most once per stage. `inviteId` is the existing row for a reminder. */
async function sendInvite(
  ctx: InviteContext,
  c: InviteContact,
  kind: InviteKind,
  inviteId: string | null,
  now: Date,
): Promise<SendOutcome> {
  const firstName = inviteFirstName(c);
  if (!firstName) {
    await stopBeforeSend(ctx, c, inviteId, "no_name");
    return "stopped";
  }
  if (kind === "opener" && (await phoneAlreadyInvited(ctx.tenantId, c))) {
    await stopBeforeSend(ctx, c, inviteId, "duplicate_phone");
    return "stopped";
  }
  // A test phone is the advisor's own and has chatted with the bot before; that must not block the test.
  const testPhone = inviteTestMode(ctx.config) && isTestLead({ apiKeyEnc: "x", testPhones: ctx.config.testPhones }, c.phone);
  if (!testPhone && (await alreadyInConversation(ctx.tenantId, [c.phone, secondPhone(c.mapped)]))) {
    await stopBeforeSend(ctx, c, inviteId, "in_conversation");
    return "stopped";
  }
  // Thread first: a failure here leaves nothing claimed and nothing sent.
  const thread = await ensureInviteThread(ctx, c);
  const claimed = await claimSend(ctx, c, kind, inviteId, now);
  if (!claimed) return "raced";
  const sending = kind === "opener" ? "sending_opener" : "sending_reminder";

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
    if (failure.kind === "blocked") {
      // Nothing went out: release the claim so the next run tries again.
      if (kind === "opener") await prisma.contactInvite.deleteMany({ where: { id: claimed, tenantId: ctx.tenantId, status: sending } });
      else await moveInvite(ctx.tenantId, claimed, sending, { status: "invited", claimedAt: null });
      log("blocked", { tenantId: ctx.tenantId, contactId: c.id, kind, reason: failure.reason });
      return "blocked";
    }
    if (failure.kind === "rejected") {
      await moveInvite(ctx.tenantId, claimed, sending, { status: "stopped", stopReason: `rejected:${failure.reason}`, claimedAt: null });
      log("stopped", { tenantId: ctx.tenantId, contactId: c.id, kind, reason: failure.reason });
      return "stopped";
    }
    await moveInvite(ctx.tenantId, claimed, sending, { status: "unknown", stopReason: failure.reason });
    await openInviteTask(ctx, c, "invite_send_unknown").catch((e) =>
      log("task_failed", { tenantId: ctx.tenantId, contactId: c.id, error: String(e) }),
    );
    log("unknown", { tenantId: ctx.tenantId, contactId: c.id, kind, reason: failure.reason });
    return "unknown";
  }

  // Sent and paid for. Never throw from here: a retry must not send it again.
  try {
    await moveInvite(ctx.tenantId, claimed, sending, {
      status: kind === "opener" ? "invited" : "reminded",
      ...(kind === "opener" ? { openerAt: now } : { reminderAt: now }),
      claimedAt: null,
      ...(opened.conversationId ? { zernioConversationId: opened.conversationId } : {}),
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

/** One pass for one tenant. Safe to run any time: every step is guarded by the row's status. Always logs one line. */
export async function runInvitesForTenant(tenantId: string, now: Date): Promise<InviteRunResult> {
  const result = await runInvites(tenantId, now);
  log("run", { tenantId, ...result });
  return result;
}

async function runInvites(tenantId: string, now: Date): Promise<InviteRunResult> {
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

  const eligible = { phoneStatus: "ok", skipped: false, source: { kind: "smartnpv" } };
  const reminders = approved.has("reminder")
    ? await prisma.contactInvite.findMany({
        where: {
          tenantId,
          status: "invited",
          openerAt: { lte: new Date(now.getTime() - INVITE_REMINDER_AFTER_MS) },
          contact: eligible,
        },
        orderBy: { openerAt: "asc" },
        take: INVITE_SEND_CAP,
        select: INVITE_SELECT,
      })
    : [];
  const testPhones = inviteTestMode(ctx.config)
    ? ctx.config.testPhones.map((p) => normalizeClientPhone(p, "972")).filter((p) => p.status === "ok").map((p) => p.phone)
    : null;
  const openers = approved.has("opener")
    ? await prisma.contact.findMany({
        where: {
          tenantId,
          ...eligible,
          invite: { is: null },
          createdAt: { gt: ctx.cutoff },
          ...(testPhones ? { phone: { in: testPhones } } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: INVITE_SEND_CAP,
        select: CONTACT_SELECT,
      })
    : [];

  const queue: Array<{ kind: InviteKind; contact: InviteContact; inviteId: string | null }> = [
    ...reminders.filter((r) => planInviteStep(r, now) === "reminder").map((r) => ({ kind: "reminder" as const, contact: r.contact, inviteId: r.id })),
    ...openers.map((c) => ({ kind: "opener" as const, contact: c, inviteId: null })),
  ];
  let budget = INVITE_SEND_CAP;
  const phonesThisRun = new Set<string>();
  for (const item of queue) {
    if (budget <= 0) break;
    // Two CRM rows for one client: one message per phone per run.
    if (phonesThisRun.has(item.contact.phone)) continue;
    phonesThisRun.add(item.contact.phone);
    const outcome = await sendInvite(ctx, item.contact, item.kind, item.inviteId, now);
    if (outcome === "blocked") return { ...result, skipped: "provider_blocked" };
    if (outcome === "sent") {
      budget--;
      if (item.kind === "opener") result.sent++;
      else result.reminded++;
    } else if (outcome === "unknown") {
      budget--;
      result.unknown++;
    } else if (outcome === "stopped") {
      result.stopped++;
    }
  }
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
  // Every open invite for this phone: two CRM rows for one client move together.
  const open = { tenantId, status: { in: INVITE_OPEN_STATUSES }, contact: { phone: digits } };
  const stop = isStopReply(text);
  const moved = await prisma.contactInvite.updateMany({
    where: open,
    data: stop ? { status: "stopped", stopReason: "client_stop" } : { status: "started", startedAt: now },
  });
  if (moved.count === 0) return "none";
  log(stop ? "stopped" : "started", { tenantId, invites: moved.count, ...(stop ? { reason: "client_stop" } : {}) });
  return stop ? "stopped" : "started";
}

export type InviteStats = { invited: number; started: number; waiting: number; handedOff: number; stopped: number };

/** Counts for the settings screen. `invited` = every contact that got an opener. */
export async function inviteStats(tenantId: string): Promise<InviteStats> {
  const [groups, invited] = await Promise.all([
    prisma.contactInvite.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
    prisma.contactInvite.count({ where: { tenantId, openerAt: { not: null } } }),
  ]);
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  return {
    invited,
    started: n("started"),
    waiting: n("invited") + n("reminded") + n("sending_opener") + n("sending_reminder"),
    handedOff: n("escalated") + n("unknown"),
    stopped: n("stopped"),
  };
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

/** `recordInviteReply` for the inbound routes: never fails the webhook. */
export async function safeRecordInviteReply(
  tenantId: string,
  from: string,
  text: string,
): Promise<"stopped" | "started" | "none"> {
  try {
    return await recordInviteReply(tenantId, from, text, new Date());
  } catch (err) {
    console.warn(JSON.stringify({ msg: "documents.invite.reply_failed", tenantId, error: String(err) }));
    return "none";
  }
}
