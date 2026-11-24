import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeClientPhone } from "@/lib/client-sources/phone";
import { getConnector } from "@/lib/client-sources/registry";
import { isProductionRuntime } from "@/lib/dev-auth-bypass";
import { leadDisplayName } from "@/lib/leads";
import { listWhatsAppTemplates, sendWhatsAppTemplate, zernioConfigured } from "@/lib/zernio";
import {
  allowList,
  audienceSchema,
  followsSource,
  startedAtRange,
  estimateCostUsd,
  campaignSendWindow,
  DUE_CAMPAIGNS_PER_TICK,
  FREQUENCY_CAP_DAYS,
  inSendWindow,
  isArchivedValue,
  OPEN_CONVERSATION_DAYS,
  paramSchema,
  resolveParams,
  sendBudget,
  STUCK_SENDING_MS,
  dueFollowUp,
  parseFollowUps,
  skipReasonFor,
  startOfZonedDay,
  type Audience,
  type FollowUpStep,
  type ParamSpec,
  type RecipientState,
  type SkipReason,
} from "./rules";
import { termsAccepted, settingsFromRow } from "./settings";
import { tenantWhatsAppAccount } from "./store";
import { isSendable, normalizeTemplateStatus } from "./templates";

/**
 * Campaign audience resolution and the send worker. Every query is scoped by
 * tenantId. Sending is one claimed row at a time (queued → sending → sent), so
 * a retried step does not send a row it already marked sent. A claim that never
 * recorded a result becomes `unknown` after STUCK_SENDING_MS and is not sent again.
 */

const DAY_MS = 24 * 3600 * 1000;
const AUDIENCE_CAP = 20_000;

export type Recipient = {
  phone: string;
  phoneStatus: "ok" | "missing" | "invalid";
  name: string;
  contactId: string | null;
  leadId: string | null;
  archived: boolean;
};

export function parseAudience(raw: unknown): Audience | null {
  const parsed = audienceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseParamSpecs(raw: unknown): ParamSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => paramSchema.safeParse(p)).flatMap((p) => (p.success ? [p.data] : []));
}

function digits(v: string): string {
  return v.replace(/\D/g, "");
}

/** WhatsApp id when it is a usable number. Otherwise the lead's phone field, as an Israeli number. */
function leadRecipientPhone(lead: { externalUserId: string; fields: unknown; channel: { provider: string } }): {
  phone: string;
  phoneStatus: Recipient["phoneStatus"];
} {
  const fromWhatsApp = lead.channel.provider === "whatsapp" ? digits(lead.externalUserId) : "";
  if (fromWhatsApp.length >= 10) return { phone: fromWhatsApp, phoneStatus: "ok" };
  const fields = (lead.fields ?? {}) as Record<string, unknown>;
  const raw = fields.phone;
  if (raw == null || (typeof raw === "string" && !raw.trim())) return { phone: "", phoneStatus: "missing" };
  const normalized = normalizeClientPhone(raw, "972");
  if (normalized.status === "ok") return { phone: normalized.phone, phoneStatus: "ok" };
  return { phone: "", phoneStatus: normalized.status === "invalid" ? "invalid" : "missing" };
}

/** Phones and people already stored on this campaign. They do not count toward the cap. */
async function alreadyOnCampaign(tenantId: string, campaignId?: string): Promise<{ contactIds: string[]; leadIds: string[]; phones: string[] }> {
  if (!campaignId) return { contactIds: [], leadIds: [], phones: [] };
  const rows = await prisma.campaignSend.findMany({
    where: { tenantId, campaignId },
    select: { contactId: true, leadId: true, phone: true },
  });
  return {
    contactIds: rows.flatMap((r) => (r.contactId ? [r.contactId] : [])),
    leadIds: rows.flatMap((r) => (r.leadId ? [r.leadId] : [])),
    phones: rows.map((r) => r.phone).filter((p) => p && !p.startsWith("none:")),
  };
}

/** Audience → one recipient per phone. Recipients with no usable phone are kept (keyed by id) so they are counted. */
export async function resolveAudience(
  tenantId: string,
  audience: Audience,
  now: Date,
  campaignId?: string,
  overflow: "refuse" | "take" = "refuse",
): Promise<Recipient[] | "audience_too_large"> {
  const taken = await alreadyOnCampaign(tenantId, campaignId);
  const out: Recipient[] = [];
  if (audience.kind === "clients") {
    const range = startedAtRange(audience, now);
    const hasRange = range.gte != null || range.lte != null;
    const dated = {
      startedAt: { not: null, ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) },
      ...(audience.confidence.length ? { startedAtConfidence: { in: audience.confidence } } : {}),
    };
    const exclude = [
      ...(taken.contactIds.length ? [{ id: { notIn: taken.contactIds } }] : []),
      ...(taken.phones.length ? [{ phone: { notIn: taken.phones } }] : []),
    ];
    const source = audience.sourceId && audience.sourceId !== "all" ? { sourceId: audience.sourceId } : {};
    // A stored client that now matches a skip rule (e.g. archived) is never an audience member.
    const where =
      audience.includeNoStartedAt && !hasRange
        ? { tenantId, skipped: false, ...source, OR: [dated, { startedAt: null }], ...(exclude.length ? { AND: exclude } : {}) }
        : { tenantId, skipped: false, ...source, ...dated, ...(exclude.length ? { AND: exclude } : {}) };
    const found = await prisma.contact.findMany({
      where,
      select: { id: true, phone: true, phoneStatus: true, name: true, leadId: true, fields: true, source: { select: { kind: true } } },
      // Dated records first, so the one-per-phone merge keeps the client with a deal date.
      orderBy: { startedAt: { sort: "desc", nulls: "last" } },
      take: AUDIENCE_CAP + 1,
    });
    // A full page means at least one more client matched. Confirm refuses. A later refresh keeps the first page.
    if (found.length > AUDIENCE_CAP && overflow === "refuse") return "audience_too_large";
    const contacts = found.slice(0, AUDIENCE_CAP);
    for (const c of contacts) {
      const field = getConnector(c.source.kind)?.archivedField;
      const fields = (c.fields ?? {}) as Record<string, unknown>;
      out.push({
        phone: c.phone,
        phoneStatus: (c.phoneStatus as Recipient["phoneStatus"]) || "missing",
        name: c.name,
        contactId: c.id,
        leadId: c.leadId,
        archived: field ? isArchivedValue(fields[field]) : false,
      });
    }
  } else {
    const leadIds = audience.leadIds.filter((id) => !taken.leadIds.includes(id));
    const leads = await prisma.lead.findMany({
      where: { tenantId, id: { in: leadIds } },
      select: { id: true, externalUserId: true, displayName: true, fields: true, channel: { select: { provider: true } } },
    });
    for (const l of leads) {
      const { phone, phoneStatus } = leadRecipientPhone(l);
      out.push({
        phone,
        phoneStatus,
        name: leadDisplayName(l),
        contactId: null,
        leadId: l.id,
        archived: false,
      });
    }
  }
  // One row per phone: a person who is both a client and a lead gets one message.
  const byPhone = new Map<string, Recipient>();
  const noPhone: Recipient[] = [];
  for (const r of out) {
    if (!r.phone || r.phoneStatus !== "ok") {
      noPhone.push(r);
      continue;
    }
    const prev = byPhone.get(r.phone);
    if (!prev) byPhone.set(r.phone, r);
    else byPhone.set(r.phone, { ...prev, leadId: prev.leadId ?? r.leadId, contactId: prev.contactId ?? r.contactId, archived: prev.archived || r.archived });
  }
  return [...byPhone.values(), ...noPhone];
}

function currentAllowList(): Set<string> | null {
  return allowList({
    production: isProductionRuntime(),
    list: process.env.CAMPAIGN_ALLOWLIST ?? "",
    only: process.env.CAMPAIGN_ALLOWLIST_ONLY ?? "",
  });
}

/** Everything the skip rules need, fetched in bulk for a set of recipients. */
export async function recipientStates(
  tenantId: string,
  campaignId: string | null,
  recipients: Recipient[],
  now: Date,
): Promise<RecipientState[]> {
  const phones = [...new Set(recipients.map((r) => r.phone).filter(Boolean))];
  const variants = phones.flatMap((p) => [p, `+${p}`]);

  const [suppressed, recentSends, leadsByPhone] = await Promise.all([
    phones.length ? prisma.suppression.findMany({ where: { tenantId, phone: { in: phones } }, select: { phone: true } }) : [],
    phones.length
      ? prisma.campaignSend.findMany({
          where: {
            tenantId,
            phone: { in: phones },
            status: "sent",
            sentAt: { gte: new Date(now.getTime() - FREQUENCY_CAP_DAYS * DAY_MS) },
            ...(campaignId ? { NOT: { campaignId } } : {}),
          },
          select: { phone: true, sentAt: true },
        })
      : [],
    variants.length
      ? prisma.lead.findMany({ where: { tenantId, externalUserId: { in: variants } }, select: { id: true, externalUserId: true } })
      : [],
  ]);
  const suppressedSet = new Set(suppressed.map((s) => s.phone));
  const lastSent = new Map<string, Date>();
  for (const s of recentSends) {
    if (!s.sentAt) continue;
    const prev = lastSent.get(s.phone);
    if (!prev || prev < s.sentAt) lastSent.set(s.phone, s.sentAt);
  }
  const leadIdsForPhone = new Map<string, string[]>();
  for (const l of leadsByPhone) {
    const key = digits(l.externalUserId);
    leadIdsForPhone.set(key, [...(leadIdsForPhone.get(key) ?? []), l.id]);
  }

  const allLeadIds = new Set<string>();
  for (const r of recipients) {
    if (r.leadId) allLeadIds.add(r.leadId);
    for (const id of leadIdsForPhone.get(r.phone) ?? []) allLeadIds.add(id);
  }
  const ids = [...allLeadIds];
  const [leads, openTasks, liveRequests] = ids.length
    ? await Promise.all([
        prisma.lead.findMany({
          where: { tenantId, id: { in: ids } },
          select: {
            id: true,
            pipelineStage: true,
            lastLeadMessageAt: true,
            lastOutboundAt: true,
            conversations: { where: { status: "open" }, select: { id: true }, take: 1 },
          },
        }),
        prisma.hitlTask.findMany({ where: { tenantId, leadId: { in: ids }, status: "open" }, select: { leadId: true } }),
        prisma.request.findMany({
          where: { tenantId, leadId: { in: ids }, status: { in: ["pending", "approved"] }, OR: [{ startAt: null }, { startAt: { gte: now } }] },
          select: { leadId: true },
        }),
      ])
    : [[], [], []];
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const busy = new Set([...openTasks.map((t) => t.leadId), ...liveRequests.map((r) => r.leadId)]);
  const allow = currentAllowList();

  return recipients.map((r) => {
    const related = [...new Set([r.leadId, ...(leadIdsForPhone.get(r.phone) ?? [])].filter((x): x is string => Boolean(x)))];
    const rows = related.map((id) => leadById.get(id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
    const lastConversationAt = rows
      .flatMap((l) => [l.lastLeadMessageAt, l.lastOutboundAt])
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      phone: r.phone,
      phoneStatus: r.phoneStatus,
      suppressed: suppressedSet.has(r.phone),
      allowListed: allow ? allow.has(r.phone) : null,
      lastCampaignSentAt: lastSent.get(r.phone) ?? null,
      lastConversationAt,
      conversationOpen: rows.some((l) => l.conversations.length > 0),
      activeCase: related.some((id) => busy.has(id)),
      leadStage: rows.find((l) => r.leadId === l.id)?.pipelineStage ?? rows[0]?.pipelineStage ?? null,
      archived: r.archived,
    };
  });
}

export type Preview = {
  total: number;
  eligible: number;
  skipped: Partial<Record<SkipReason, number>>;
  sample: string[];
  costUsd: number;
};

type CampaignForRun = {
  id: string;
  tenantId: string;
  audience: unknown;
  params: unknown;
  template: { category: string };
};

async function businessName(tenantId: string): Promise<string> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  return t?.name ?? "";
}

/** Who would get it right now, and why the rest would not. Nothing is written. */
export async function previewCampaign(campaign: CampaignForRun, now = new Date()): Promise<Preview | { error: "bad_audience" | "audience_too_large" }> {
  const audience = parseAudience(campaign.audience);
  if (!audience) return { error: "bad_audience" };
  const recipients = await resolveAudience(campaign.tenantId, audience, now, campaign.id);
  if (recipients === "audience_too_large") return { error: "audience_too_large" };
  const states = await recipientStates(campaign.tenantId, campaign.id, recipients, now);
  const specs = parseParamSpecs(campaign.params);
  const biz = await businessName(campaign.tenantId);
  const skipped: Partial<Record<SkipReason, number>> = {};
  const sample: string[] = [];
  let eligible = 0;
  recipients.forEach((r, i) => {
    const reason = skipReasonFor(states[i], now) ?? (resolveParams(specs, { name: r.name, businessName: biz }) ? null : "missing_param");
    if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
    else {
      eligible += 1;
      if (sample.length < 5) sample.push(r.name || r.phone);
    }
  });
  return { total: recipients.length, eligible, skipped, sample, costUsd: estimateCostUsd(eligible, campaign.template.category) };
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export type PrepareResult =
  | { go: true; budget: number }
  | { go: false; reason: "not_due" | "not_runnable" | "quiet_hours" | "daily_ceiling" | "paused" | "done" | "waiting_for_clients" | "waiting_follow_up" | "gone" };

const RUNNABLE = ["scheduled", "sending"] as const;

/** Status change only while the campaign is still scheduled or sending. A pause or cancel that landed first is left alone. */
async function markRunnable(tenantId: string, campaignId: string, data: Prisma.CampaignUpdateManyMutationInput): Promise<boolean> {
  const res = await prisma.campaign.updateMany({ where: { id: campaignId, tenantId, status: { in: [...RUNNABLE] } }, data });
  return res.count > 0;
}

async function pause(tenantId: string, campaignId: string, reason: string): Promise<boolean> {
  const changed = await markRunnable(tenantId, campaignId, { status: "paused", pauseReason: reason });
  if (changed) console.log(JSON.stringify({ msg: "campaigns.paused", tenantId, campaignId, reason }));
  return changed;
}

async function sentTodayCount(tenantId: string, now: Date, tz: string): Promise<number> {
  return prisma.campaignSend.count({
    where: { tenantId, status: "sent", sentAt: { gte: startOfZonedDay(now, tz) } },
  });
}

async function sentCount(campaignId: string): Promise<number> {
  return prisma.campaignSend.count({ where: { campaignId, status: "sent" } });
}

/** Re-read the template's status from Meta. A template that is no longer approved pauses the campaign. */
async function templateStillApproved(t: { id: string; accountId: string; name: string; language: string; status: string }): Promise<boolean> {
  if (!zernioConfigured()) return isSendable(t.status);
  try {
    const live = await listWhatsAppTemplates(t.accountId);
    const found = live.find((l) => l.name === t.name && l.language === t.language);
    const status = found ? normalizeTemplateStatus(found.status) : "DISABLED";
    if (status !== t.status) await prisma.whatsAppTemplate.update({ where: { id: t.id }, data: { status } });
    return isSendable(status);
  } catch {
    // Meta unreachable: trust the stored status rather than stall; sends fail loudly if it changed.
    return isSendable(t.status);
  }
}

type ClockRow = {
  id: string;
  tenantId: string;
  campaignId: string;
  phone: string;
  name: string;
  leadId: string | null;
  status: string;
  params: unknown;
  sentAt: Date | null;
  startedAt: Date | null;
  escalatedAt: Date | null;
  reminderClaimedAt: Date | null;
  reminderSentAt: Date | null;
};

async function openSequences(campaignId: string, tenantId: string): Promise<ClockRow[]> {
  return prisma.campaignSend.findMany({
    where: { campaignId, tenantId, status: { in: ["sent", "sending"] }, startedAt: null, escalatedAt: null },
    take: 200,
  }) as Promise<ClockRow[]>;
}

/** A claim with no result is unknown. One advisor task, and it is not queued again. */
async function settleUnknownClaims(tenantId: string, campaignId: string, now: Date): Promise<void> {
  const stale = new Date(now.getTime() - STUCK_SENDING_MS);
  await prisma.campaignSend.updateMany({
    where: { tenantId, campaignId, status: "sending", startedAt: null, updatedAt: { lt: stale } },
    data: { status: "unknown" },
  });
  const rows = (await openSequences(campaignId, tenantId)) as ClockRow[];
  for (const row of rows) {
    if (dueFollowUp(row, [{ templateId: "x", delayMs: 60_000, onSilence: "send" }], now) !== "unknown_claim") continue;
    await prisma.campaignSend.updateMany({
      where: { id: row.id, tenantId, reminderSentAt: null, startedAt: null },
      data: { status: "unknown" },
    });
  }
  const unknown = await prisma.campaignSend.findMany({
    where: { campaignId, tenantId, status: "unknown", escalatedAt: null },
    take: 50,
  });
  for (const row of unknown) {
    await openCampaignTask(tenantId, row as ClockRow, "campaign_send_unknown");
    await prisma.campaignSend.updateMany({ where: { id: row.id, tenantId, escalatedAt: null }, data: { escalatedAt: now } });
  }
}

/** 48 hours after the reminder (or after the opener, when that is the escalate step) with no reply. */
async function escalateDue(tenantId: string, campaignId: string, rawSteps: unknown, now: Date): Promise<void> {
  const steps = parseFollowUps(rawSteps);
  if (!steps.some((s) => s.onSilence === "escalate")) return;
  const rows = await openSequences(campaignId, tenantId);
  for (const row of rows) {
    if (dueFollowUp(row, steps, now) !== "escalate") continue;
    const claimed = await prisma.campaignSend.updateMany({
      where: { id: row.id, tenantId, escalatedAt: null, startedAt: null },
      data: { escalatedAt: now },
    });
    if (claimed.count === 0) continue;
    await openCampaignTask(tenantId, row, "campaign_no_start");
  }
}

async function remindersDue(campaignId: string, tenantId: string, steps: FollowUpStep[], now: Date): Promise<boolean> {
  const rows = await openSequences(campaignId, tenantId);
  return rows.some((row) => dueFollowUp(row, steps, now) === "reminder");
}

async function followUpsWaiting(campaignId: string, tenantId: string): Promise<boolean> {
  const waiting = await prisma.campaignSend.findFirst({
    where: { campaignId, tenantId, status: "sent", startedAt: null, escalatedAt: null },
    select: { id: true },
  });
  return Boolean(waiting);
}

const TASK_SUMMARY = {
  campaign_send_unknown: "לא ברור אם הודעת הקמפיין נשלחה. לא נשלח שוב אוטומטית. כדאי לבדוק וליצור קשר.",
  campaign_no_start: "קיבל הודעה ותזכורת ועוד לא ענה. כדאי ליצור קשר.",
} as const;

async function openCampaignTask(tenantId: string, row: ClockRow, reason: keyof typeof TASK_SUMMARY): Promise<void> {
  const thread = await ensureCampaignThread(tenantId, row, "");
  if (!thread) return;
  const existing = await prisma.hitlTask.findFirst({
    where: { tenantId, conversationId: thread.conversationId, reason, status: "open" },
    select: { id: true },
  });
  if (existing) return;
  await prisma.hitlTask.create({
    data: {
      tenantId,
      conversationId: thread.conversationId,
      leadId: thread.leadId,
      type: "more_info",
      reason,
      payload: { summary: TASK_SUMMARY[reason], kind: reason },
      status: "open",
    },
  });
}

/** The opener lives in the lead's open conversation, so a later reply does not get a second greeting. */
export async function ensureCampaignThread(
  tenantId: string,
  row: { id: string; phone: string; name: string; leadId: string | null },
  text: string,
): Promise<{ leadId: string; conversationId: string } | null> {
  const channel = await prisma.channelConnection.findFirst({
    where: { tenantId, provider: "whatsapp", enabled: true },
    select: { id: true, agentId: true },
  });
  if (!channel?.agentId) return null;
  let lead = row.leadId
    ? await prisma.lead.findFirst({ where: { id: row.leadId, tenantId }, select: { id: true } })
    : null;
  if (!lead) {
    lead = await prisma.lead.findFirst({
      where: { tenantId, channelId: channel.id, externalUserId: row.phone },
      select: { id: true },
    });
  }
  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        tenantId,
        channelId: channel.id,
        externalUserId: row.phone,
        displayName: row.name || row.phone,
        fields: { phone: row.phone },
      },
      select: { id: true },
    });
  }
  let conversation = await prisma.conversation.findFirst({
    where: { tenantId, leadId: lead.id, status: "open" },
    select: { id: true },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId,
        leadId: lead.id,
        channelId: channel.id,
        agentId: channel.agentId,
        status: "open",
        flowState: "talk",
        flowVersion: 1,
        lifecycleReason: "campaign",
      },
      select: { id: true },
    });
  }
  if (text.trim()) {
    const providerMessageId = `campaign-${row.id}`;
    const existing = await prisma.message.findFirst({ where: { tenantId, providerMessageId }, select: { id: true } });
    if (!existing) {
      await prisma.message.create({
        data: { tenantId, conversationId: conversation.id, role: "agent", text, providerMessageId },
      });
    }
  }
  if (row.leadId !== lead.id) {
    await prisma.campaignSend.updateMany({ where: { id: row.id, tenantId }, data: { leadId: lead.id } });
  }
  return { leadId: lead.id, conversationId: conversation.id };
}

/** Gatekeeping before any send: add-on, terms, declaration, number, template, time, budget. Materializes the audience once. */
export async function prepareCampaignRun(tenantId: string, campaignId: string, now = new Date()): Promise<PrepareResult> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId },
    include: { template: true, declaration: { select: { id: true } }, tenant: { select: { timezone: true, name: true } } },
  });
  if (!campaign) return { go: false, reason: "gone" };
  if (campaign.status === "paused") return { go: false, reason: "paused" };
  if (campaign.status !== "scheduled" && campaign.status !== "sending") return { go: false, reason: "not_runnable" };
  if (!campaign.scheduledAt || campaign.scheduledAt > now) return { go: false, reason: "not_due" };

  await settleUnknownClaims(tenantId, campaignId, now);
  await escalateDue(tenantId, campaignId, campaign.followUps, now);

  const settings = settingsFromRow(await prisma.tenantCampaignSettings.findUnique({ where: { tenantId } }));
  if (!settings.enabled || !termsAccepted(settings)) {
    return (await pause(tenantId, campaignId, "addon_off")) ? { go: false, reason: "paused" } : { go: false, reason: "not_runnable" };
  }
  if (!campaign.declaration) {
    // Never reachable through the API (confirm writes both together); refuse anyway.
    return (await pause(tenantId, campaignId, "no_declaration")) ? { go: false, reason: "paused" } : { go: false, reason: "not_runnable" };
  }
  const account = await tenantWhatsAppAccount(tenantId);
  if (!account || account.accountId !== campaign.template.accountId) {
    return (await pause(tenantId, campaignId, "no_whatsapp")) ? { go: false, reason: "paused" } : { go: false, reason: "not_runnable" };
  }
  const tz = campaign.tenant.timezone || "Asia/Jerusalem";
  if (!inSendWindow(now, tz, campaignSendWindow(campaign.sendWindow))) {
    if (!(await markRunnable(tenantId, campaignId, { waitReason: "quiet_hours" }))) return { go: false, reason: "not_runnable" };
    return { go: false, reason: "quiet_hours" };
  }
  if (!(await templateStillApproved(campaign.template))) {
    return (await pause(tenantId, campaignId, "template_not_approved")) ? { go: false, reason: "paused" } : { go: false, reason: "not_runnable" };
  }
  for (const step of parseFollowUps(campaign.followUps)) {
    if (!step.templateId) continue;
    const follow = await prisma.whatsAppTemplate.findFirst({ where: { id: step.templateId, tenantId } });
    if (!follow || !(await templateStillApproved(follow))) {
      return (await pause(tenantId, campaignId, "template_not_approved")) ? { go: false, reason: "paused" } : { go: false, reason: "not_runnable" };
    }
  }

  if (!campaign.materializedAt) {
    const overflow = await materialize(campaign, now);
    if (overflow === "audience_too_large") {
      return (await pause(tenantId, campaignId, "audience_too_large")) ? { go: false, reason: "paused" } : { go: false, reason: "not_runnable" };
    }
  }
  const live = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { status: true } });
  if (live?.status === "canceled") {
    await prisma.campaignSend.updateMany({ where: { campaignId, tenantId, status: "queued" }, data: { status: "skipped", skipReason: "canceled" } });
    return { go: false, reason: "not_runnable" };
  }
  if (live?.status !== "scheduled" && live?.status !== "sending") return { go: false, reason: "not_runnable" };

  const audience = parseAudience(campaign.audience);
  if (audience && followsSource(audience)) await appendAudience(campaign, now);

  const [sentToday, sentTotal] = await Promise.all([sentTodayCount(tenantId, now, tz), sentCount(campaignId)]);
  let batchStartAt = campaign.batchStartAt;
  if (campaign.resetBatch) {
    batchStartAt = sentTotal;
    if (!(await markRunnable(tenantId, campaignId, { batchStartAt, resetBatch: false }))) return { go: false, reason: "not_runnable" };
  }
  const { budget, limitedBy } = sendBudget({
    dailyCeiling: settings.dailySendCeiling,
    sentToday,
    batchSize: campaign.batchSize,
    sentInBatch: sentTotal - batchStartAt,
    maxSendsPerRun: settings.maxSendsPerRun,
  });
  const queued = await prisma.campaignSend.count({ where: { campaignId, status: "queued" } });
  const steps = parseFollowUps(campaign.followUps);
  const dueReminders = steps.length > 0 && (await remindersDue(campaignId, tenantId, steps, now));
  if (queued === 0 && !dueReminders) {
    if (steps.length > 0 && (await followUpsWaiting(campaignId, tenantId))) {
      const waiting = await markRunnable(tenantId, campaignId, { status: "scheduled", waitReason: "waiting_follow_up" });
      return waiting ? { go: false, reason: "waiting_follow_up" } : { go: false, reason: "not_runnable" };
    }
    if (audience && followsSource(audience)) {
      const waiting = await markRunnable(tenantId, campaignId, { status: "scheduled", waitReason: "waiting_for_clients" });
      return waiting ? { go: false, reason: "waiting_for_clients" } : { go: false, reason: "not_runnable" };
    }
    return (await markRunnable(tenantId, campaignId, { status: "done", waitReason: "" })) ? { go: false, reason: "done" } : { go: false, reason: "not_runnable" };
  }
  if (limitedBy === "batch") {
    return (await pause(tenantId, campaignId, "batch_done")) ? { go: false, reason: "paused" } : { go: false, reason: "not_runnable" };
  }
  if (budget === 0) {
    if (!(await markRunnable(tenantId, campaignId, { waitReason: "daily_ceiling", status: "sending" }))) return { go: false, reason: "not_runnable" };
    return { go: false, reason: "daily_ceiling" };
  }
  if (!(await markRunnable(tenantId, campaignId, { status: "sending", waitReason: "" }))) return { go: false, reason: "not_runnable" };
  return { go: true, budget };
}

type SendWriter = Prisma.TransactionClient | typeof prisma;

function structuralSkip(r: Recipient, params: string[] | null): SkipReason | null {
  if (r.phoneStatus === "missing" || (!r.phone && r.phoneStatus === "ok")) return "no_phone";
  if (r.phoneStatus === "invalid") return "invalid_phone";
  if (!params) return "missing_param";
  return null;
}

function toSendRows(
  campaign: { id: string; tenantId: string },
  recipients: Recipient[],
  reasonFor: (r: Recipient, i: number) => SkipReason | null,
  paramsFor: (r: Recipient) => string[] | null,
) {
  return recipients.map((r, i) => {
    const params = paramsFor(r);
    const reason = reasonFor(r, i);
    return {
      tenantId: campaign.tenantId,
      campaignId: campaign.id,
      // Rows with no phone still get a unique key so they are counted as skipped.
      phone: r.phone || `none:${r.contactId ?? r.leadId ?? i}`,
      name: r.name,
      contactId: r.contactId,
      leadId: r.leadId,
      status: reason ? "skipped" : "queued",
      skipReason: reason ?? "",
      params: params ?? [],
    };
  });
}

async function insertSendRows(db: SendWriter, rows: ReturnType<typeof toSendRows>) {
  for (let i = 0; i < rows.length; i += 1000) {
    await db.campaignSend.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
  }
}

/**
 * Freeze who can receive this campaign. Structural skips (no phone, invalid phone,
 * empty template value) are skipped rows. Everyone else is queued; time-varying
 * rules are applied when the chunk sends. Nothing here is committed until the caller commits.
 */
export async function freezeAudience(
  tx: Prisma.TransactionClient,
  campaign: CampaignForRun & { tenant: { name: string } },
  now: Date,
): Promise<"audience_too_large" | "bad_audience" | null> {
  const audience = parseAudience(campaign.audience);
  if (!audience) return "bad_audience";
  const recipients = await resolveAudience(campaign.tenantId, audience, now, campaign.id);
  if (recipients === "audience_too_large") return "audience_too_large";
  const specs = parseParamSpecs(campaign.params);
  const rows = toSendRows(
    campaign,
    recipients,
    (r) => structuralSkip(r, resolveParams(specs, { name: r.name, businessName: campaign.tenant.name })),
    (r) => resolveParams(specs, { name: r.name, businessName: campaign.tenant.name }),
  );
  await insertSendRows(tx, rows);
  return null;
}

/**
 * Add people the source has synced since the last run. People already stored on this
 * campaign are left as they are. At most one cap of new rows per run; the rest wait.
 * Does not move materializedAt.
 */
async function appendAudience(campaign: CampaignForRun & { tenant: { name: string } }, now: Date): Promise<void> {
  const audience = parseAudience(campaign.audience);
  if (!audience || !followsSource(audience)) return;
  const recipients = await resolveAudience(campaign.tenantId, audience, now, campaign.id, "take");
  if (recipients === "audience_too_large" || recipients.length === 0) return;
  const specs = parseParamSpecs(campaign.params);
  const rows = toSendRows(
    campaign,
    recipients,
    (r) => structuralSkip(r, resolveParams(specs, { name: r.name, businessName: campaign.tenant.name })),
    (r) => resolveParams(specs, { name: r.name, businessName: campaign.tenant.name }),
  );
  await insertSendRows(prisma, rows);
}

/** Fallback for a campaign confirmed before rows were frozen. Applies every skip rule. Safe to repeat. */
async function materialize(campaign: CampaignForRun & { tenant: { name: string } }, now: Date): Promise<"audience_too_large" | null> {
  const audience = parseAudience(campaign.audience);
  const resolved = audience ? await resolveAudience(campaign.tenantId, audience, now, campaign.id) : [];
  if (resolved === "audience_too_large") return "audience_too_large";
  const states = await recipientStates(campaign.tenantId, campaign.id, resolved, now);
  const specs = parseParamSpecs(campaign.params);
  const rows = toSendRows(
    campaign,
    resolved,
    (r, i) => skipReasonFor(states[i], now) ?? (resolveParams(specs, { name: r.name, businessName: campaign.tenant.name }) ? null : "missing_param"),
    (r) => resolveParams(specs, { name: r.name, businessName: campaign.tenant.name }),
  );
  await insertSendRows(prisma, rows);
  await markRunnable(campaign.tenantId, campaign.id, { materializedAt: now });
  return null;
}

async function archivedByContact(tenantId: string, contactIds: string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(contactIds)];
  if (!ids.length) return new Map();
  const contacts = await prisma.contact.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, fields: true, source: { select: { kind: true } } },
  });
  const out = new Map<string, boolean>();
  for (const c of contacts) {
    const field = getConnector(c.source.kind)?.archivedField;
    const fields = (c.fields ?? {}) as Record<string, unknown>;
    out.set(c.id, field ? isArchivedValue(fields[field]) : false);
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ChunkResult = {
  sent: number;
  skipped: number;
  failed: number;
  attempted: number;
  queuedLeft: number;
  /** Wall clock of this chunk, including the pause between sends. */
  elapsedMs: number;
  /** Work on each row, excluding that pause. */
  processMs: number;
  /** Rows this chunk decided: sent, failed, or skipped. */
  rows: number;
  /** Reminders still due after this chunk. */
  followUpsLeft: number;
};

/**
 * Send up to `limit` queued rows. Each row is re-checked against the skip rules
 * first (someone may have opted out or replied since), then claimed with a
 * conditional update so a retried step cannot send it twice.
 */
export async function sendCampaignChunk(tenantId: string, campaignId: string, limit: number, now = new Date()): Promise<ChunkResult> {
  const chunkStarted = Date.now();
  const result: ChunkResult = { sent: 0, skipped: 0, failed: 0, attempted: 0, queuedLeft: 0, elapsedMs: 0, processMs: 0, rows: 0, followUpsLeft: 0 };
  const finish = (): ChunkResult => {
    result.elapsedMs = Date.now() - chunkStarted;
    return result;
  };
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId },
    include: { template: true, tenant: { select: { timezone: true } } },
  });
  if (!campaign || campaign.status !== "sending") return finish();
  if (!inSendWindow(now, campaign.tenant.timezone || "Asia/Jerusalem", campaignSendWindow(campaign.sendWindow))) return finish();
  const settings = settingsFromRow(await prisma.tenantCampaignSettings.findUnique({ where: { tenantId } }));

  const rows = await prisma.campaignSend.findMany({
    where: { campaignId, tenantId, status: "queued", startedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const archived = await archivedByContact(
    tenantId,
    rows.flatMap((r) => (r.contactId ? [r.contactId] : [])),
  );
  const states = await recipientStates(
    tenantId,
    campaignId,
    rows.map((r) => ({
      phone: r.phone.startsWith("none:") ? "" : r.phone,
      phoneStatus: r.phone.startsWith("none:") ? "missing" : "ok",
      name: r.name,
      contactId: r.contactId,
      leadId: r.leadId,
      archived: r.contactId ? (archived.get(r.contactId) ?? false) : false,
    })),
    now,
  );
  const dryRun = !zernioConfigured() && !isProductionRuntime();

  for (let i = 0; i < rows.length; i++) {
    const live = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { status: true } });
    if (live?.status !== "sending") break;
    const rowStarted = Date.now();
    const row = rows[i];
    const reason = skipReasonFor(states[i], now);
    if (reason) {
      await prisma.campaignSend.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "skipped", skipReason: reason } });
      result.skipped += 1;
      result.rows += 1;
      result.processMs += Date.now() - rowStarted;
    } else {
      const claimed = await prisma.campaignSend.updateMany({
        where: { id: row.id, status: "queued" },
        data: { status: "sending" },
      });
      if (claimed.count !== 0) {
        result.attempted += 1;
        result.rows += 1;
        try {
          const params = Array.isArray(row.params) ? (row.params as string[]) : [];
          const res = dryRun
            ? { conversationId: "dry-run" }
            : await sendWhatsAppTemplate({
                accountId: campaign.template.accountId,
                phone: row.phone,
                template: { name: campaign.template.name, language: campaign.template.language },
                params,
              });
          await prisma.campaignSend.update({
            where: { id: row.id },
            data: { status: "sent", sentAt: new Date(), providerConversationId: res.conversationId, error: dryRun ? "dry_run" : "" },
          });
          result.sent += 1;
          try {
            await ensureCampaignThread(tenantId, row, campaign.template.text ?? "");
          } catch {
            // The template already went out. The next run can attach the thread.
          }
        } catch (err) {
          const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
          await prisma.campaignSend.update({ where: { id: row.id }, data: { status: "failed", error: message } });
          result.failed += 1;
        }
        result.processMs += Date.now() - rowStarted;
      }
    }
    if (i < rows.length - 1) await sleep(settings.sendGapMs);
  }
  await sendDueReminders(tenantId, campaign, Math.max(0, limit - result.attempted), now, dryRun, result);
  result.queuedLeft = await prisma.campaignSend.count({ where: { campaignId, status: "queued", startedAt: null } });
  const steps = parseFollowUps(campaign.followUps);
  if (steps.length) {
    const open = await openSequences(campaignId, tenantId);
    result.followUpsLeft = open.filter((row) => dueFollowUp(row, steps, now) === "reminder").length;
  }
  return finish();
}

/** One reminder per person, after the opener, inside the same budget. A suppression that landed since the opener stops it. */
async function sendDueReminders(
  tenantId: string,
  campaign: { id: string; followUps: unknown; template: { accountId: string } },
  limit: number,
  now: Date,
  dryRun: boolean,
  result: ChunkResult,
): Promise<void> {
  const steps = parseFollowUps(campaign.followUps);
  const step = steps.find((s) => s.onSilence === "send" && s.templateId);
  if (!step?.templateId || limit <= 0) return;
  const template = await prisma.whatsAppTemplate.findFirst({ where: { id: step.templateId, tenantId } });
  if (!template || !isSendable(template.status)) return;
  const rows = await openSequences(campaign.id, tenantId);
  let used = 0;
  for (const row of rows) {
    if (used >= limit) break;
    if (dueFollowUp(row, steps, now) !== "reminder") continue;
    const suppressed = await prisma.suppression.findFirst({ where: { tenantId, phone: row.phone }, select: { id: true } });
    if (suppressed) {
      await prisma.campaignSend.updateMany({ where: { id: row.id, tenantId, startedAt: null }, data: { startedAt: now } });
      continue;
    }
    const claimed = await prisma.campaignSend.updateMany({
      where: { id: row.id, tenantId, status: "sent", reminderClaimedAt: null, reminderSentAt: null, startedAt: null },
      data: { reminderClaimedAt: now },
    });
    if (claimed.count === 0) continue;
    used += 1;
    result.attempted += 1;
    result.rows += 1;
    try {
      const params = Array.isArray(row.params) ? (row.params as string[]) : [];
      const res = dryRun
        ? { conversationId: "dry-run" }
        : await sendWhatsAppTemplate({
            accountId: template.accountId,
            phone: row.phone,
            template: { name: template.name, language: template.language },
            params,
          });
      await prisma.campaignSend.update({
        where: { id: row.id },
        data: { reminderSentAt: new Date(), providerConversationId: res.conversationId },
      });
      result.sent += 1;
    } catch (err) {
      console.log(`Error sending reminders: ${err}`)
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await prisma.campaignSend.update({ where: { id: row.id }, data: { status: "unknown", error: message } });
      result.failed += 1;
    }
  }
}

/** After a run: done when nothing is queued; paused when the batch is used up. */
export async function finishCampaignRun(tenantId: string, campaignId: string): Promise<string> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign || campaign.status !== "sending") return campaign?.status ?? "gone";
  const [queued, sentTotal] = await Promise.all([
    prisma.campaignSend.count({ where: { campaignId, status: "queued" } }),
    sentCount(campaignId),
  ]);
  if (queued === 0) {
    if (parseFollowUps(campaign.followUps).length > 0 && (await followUpsWaiting(campaignId, tenantId))) {
      if (!(await markRunnable(tenantId, campaignId, { status: "scheduled", waitReason: "waiting_follow_up" }))) {
        const current = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { status: true } });
        return current?.status ?? "gone";
      }
      return "scheduled";
    }
    if (!(await markRunnable(tenantId, campaignId, { status: "done", waitReason: "" }))) {
      const current = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { status: true } });
      return current?.status ?? "gone";
    }
    return "done";
  }
  if (campaign.batchSize != null && sentTotal - campaign.batchStartAt >= campaign.batchSize) {
    return (await pause(tenantId, campaignId, "batch_done")) ? "paused" : (campaign.status ?? "gone");
  }
  return "sending";
}

/** Campaigns the tick should run now. */
export async function dueCampaigns(now = new Date()): Promise<{ id: string; tenantId: string }[]> {
  return prisma.campaign.findMany({
    where: { status: { in: ["scheduled", "sending"] }, scheduledAt: { lte: now } },
    select: { id: true, tenantId: true },
    take: DUE_CAMPAIGNS_PER_TICK,
  });
}
