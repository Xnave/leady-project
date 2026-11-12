import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/client-sources/registry";
import { isProductionRuntime } from "@/lib/dev-auth-bypass";
import { leadDisplayName } from "@/lib/leads";
import { listWhatsAppTemplates, sendWhatsAppTemplate, zernioConfigured } from "@/lib/zernio";
import {
  allowList,
  audienceSchema,
  dealDateRange,
  estimateCostUsd,
  FREQUENCY_CAP_DAYS,
  inSendWindow,
  isArchivedValue,
  OPEN_CONVERSATION_DAYS,
  paramSchema,
  resolveParams,
  SEND_GAP_MS,
  sendBudget,
  skipReasonFor,
  startOfZonedDay,
  type Audience,
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
 * a retried step never sends the same row twice.
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

/** Audience → one recipient per phone. Recipients with no usable phone are kept (keyed by id) so they are counted. */
export async function resolveAudience(tenantId: string, audience: Audience, now: Date): Promise<Recipient[]> {
  const out: Recipient[] = [];
  if (audience.kind === "clients") {
    const range = dealDateRange(audience, now);
    const hasRange = range.gte != null || range.lte != null;
    const dated = {
      dealDate: { not: null, ...(range.gte ? { gte: range.gte } : {}), ...(range.lte ? { lte: range.lte } : {}) },
      ...(audience.confidence.length ? { dealDateConfidence: { in: audience.confidence } } : {}),
    };
    // A stored client that now matches a skip rule (e.g. archived) is never an audience member.
    const where =
      audience.includeNoDealDate && !hasRange
        ? { tenantId, skipped: false, OR: [dated, { dealDate: null }] }
        : { tenantId, skipped: false, ...dated };
    const contacts = await prisma.contact.findMany({
      where,
      select: { id: true, phone: true, phoneStatus: true, name: true, leadId: true, fields: true, source: { select: { kind: true } } },
      // Dated records first, so the one-per-phone merge keeps the client with a deal date.
      orderBy: { dealDate: { sort: "desc", nulls: "last" } },
      take: AUDIENCE_CAP,
    });
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
    const leads = await prisma.lead.findMany({
      where: { tenantId, id: { in: audience.leadIds } },
      select: { id: true, externalUserId: true, displayName: true, fields: true, channel: { select: { provider: true } } },
    });
    for (const l of leads) {
      const phone = l.channel.provider === "whatsapp" ? digits(l.externalUserId) : "";
      out.push({
        phone: phone.length >= 10 ? phone : "",
        phoneStatus: phone.length >= 10 ? "ok" : "missing",
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
            status: { in: ["sent", "sending"] },
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
export async function previewCampaign(campaign: CampaignForRun, now = new Date()): Promise<Preview | { error: "bad_audience" }> {
  const audience = parseAudience(campaign.audience);
  if (!audience) return { error: "bad_audience" };
  const recipients = await resolveAudience(campaign.tenantId, audience, now);
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
  | { go: false; reason: "not_due" | "not_runnable" | "quiet_hours" | "daily_ceiling" | "paused" | "done" | "gone" };

async function pause(tenantId: string, campaignId: string, reason: string) {
  await prisma.campaign.updateMany({ where: { id: campaignId, tenantId }, data: { status: "paused", pauseReason: reason } });
  console.log(JSON.stringify({ msg: "campaigns.paused", tenantId, campaignId, reason }));
}

async function sentTodayCount(tenantId: string, now: Date, tz: string): Promise<number> {
  return prisma.campaignSend.count({
    where: { tenantId, status: { in: ["sent", "sending"] }, sentAt: { gte: startOfZonedDay(now, tz) } },
  });
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

  const settings = settingsFromRow(await prisma.tenantCampaignSettings.findUnique({ where: { tenantId } }));
  if (!settings.enabled || !termsAccepted(settings)) {
    await pause(tenantId, campaignId, "addon_off");
    return { go: false, reason: "paused" };
  }
  if (!campaign.declaration) {
    // Never reachable through the API (confirm writes both together); refuse anyway.
    await pause(tenantId, campaignId, "no_declaration");
    return { go: false, reason: "paused" };
  }
  const account = await tenantWhatsAppAccount(tenantId);
  if (!account || account.accountId !== campaign.template.accountId) {
    await pause(tenantId, campaignId, "no_whatsapp");
    return { go: false, reason: "paused" };
  }
  const tz = campaign.tenant.timezone || "Asia/Jerusalem";
  if (!inSendWindow(now, tz)) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { waitReason: "quiet_hours" } });
    return { go: false, reason: "quiet_hours" };
  }
  if (!(await templateStillApproved(campaign.template))) {
    await pause(tenantId, campaignId, "template_not_approved");
    return { go: false, reason: "paused" };
  }

  if (!campaign.materializedAt) await materialize(campaign, now);

  const [sentToday, sentTotal] = await Promise.all([
    sentTodayCount(tenantId, now, tz),
    prisma.campaignSend.count({ where: { campaignId, status: { in: ["sent", "sending"] } } }),
  ]);
  const { budget, limitedBy } = sendBudget({
    dailyCeiling: settings.dailySendCeiling,
    sentToday,
    batchSize: campaign.batchSize,
    sentInBatch: sentTotal - campaign.batchStartAt,
  });
  const queued = await prisma.campaignSend.count({ where: { campaignId, status: "queued" } });
  if (queued === 0) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "done", waitReason: "" } });
    return { go: false, reason: "done" };
  }
  if (limitedBy === "batch") {
    await pause(tenantId, campaignId, "batch_done");
    return { go: false, reason: "paused" };
  }
  if (budget === 0) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { waitReason: "daily_ceiling", status: "sending" } });
    return { go: false, reason: "daily_ceiling" };
  }
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "sending", waitReason: "" } });
  return { go: true, budget };
}

/** Turn the audience into CampaignSend rows: queued, or skipped with a reason. Safe to repeat. */
async function materialize(campaign: CampaignForRun & { tenant: { name: string } }, now: Date) {
  const audience = parseAudience(campaign.audience);
  const recipients = audience ? await resolveAudience(campaign.tenantId, audience, now) : [];
  const states = await recipientStates(campaign.tenantId, campaign.id, recipients, now);
  const specs = parseParamSpecs(campaign.params);
  const rows = recipients.map((r, i) => {
    const params = resolveParams(specs, { name: r.name, businessName: campaign.tenant.name });
    const reason = skipReasonFor(states[i], now) ?? (params ? null : "missing_param");
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
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.campaignSend.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
  }
  await prisma.campaign.update({ where: { id: campaign.id }, data: { materializedAt: now } });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ChunkResult = { sent: number; skipped: number; failed: number; attempted: number; queuedLeft: number };

/**
 * Send up to `limit` queued rows. Each row is re-checked against the skip rules
 * first (someone may have opted out or replied since), then claimed with a
 * conditional update so a retried step cannot send it twice.
 */
export async function sendCampaignChunk(tenantId: string, campaignId: string, limit: number, now = new Date()): Promise<ChunkResult> {
  const result: ChunkResult = { sent: 0, skipped: 0, failed: 0, attempted: 0, queuedLeft: 0 };
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, tenantId },
    include: { template: true, tenant: { select: { timezone: true } } },
  });
  if (!campaign || campaign.status !== "sending") return result;
  if (!inSendWindow(now, campaign.tenant.timezone || "Asia/Jerusalem")) return result;

  const rows = await prisma.campaignSend.findMany({
    where: { campaignId, tenantId, status: "queued" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const states = await recipientStates(
    tenantId,
    campaignId,
    rows.map((r) => ({ phone: r.phone, phoneStatus: "ok", name: r.name, contactId: r.contactId, leadId: r.leadId, archived: false })),
    now,
  );
  const dryRun = !zernioConfigured() && !isProductionRuntime();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const reason = skipReasonFor(states[i], now);
    if (reason) {
      await prisma.campaignSend.updateMany({ where: { id: row.id, status: "queued" }, data: { status: "skipped", skipReason: reason } });
      result.skipped += 1;
      continue;
    }
    const claimed = await prisma.campaignSend.updateMany({
      where: { id: row.id, status: "queued" },
      data: { status: "sending", sentAt: new Date() },
    });
    if (claimed.count === 0) continue;
    result.attempted += 1;
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
        data: { status: "sent", providerConversationId: res.conversationId, error: dryRun ? "dry_run" : "" },
      });
      result.sent += 1;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await prisma.campaignSend.update({ where: { id: row.id }, data: { status: "failed", error: message } });
      result.failed += 1;
    }
    if (i < rows.length - 1) await sleep(SEND_GAP_MS);
  }
  result.queuedLeft = await prisma.campaignSend.count({ where: { campaignId, status: "queued" } });
  return result;
}

/** After a run: done when nothing is queued; paused when the batch is used up. */
export async function finishCampaignRun(tenantId: string, campaignId: string): Promise<string> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign || campaign.status !== "sending") return campaign?.status ?? "gone";
  const [queued, sentTotal] = await Promise.all([
    prisma.campaignSend.count({ where: { campaignId, status: "queued" } }),
    prisma.campaignSend.count({ where: { campaignId, status: { in: ["sent", "sending"] } } }),
  ]);
  if (queued === 0) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "done", waitReason: "" } });
    return "done";
  }
  if (campaign.batchSize != null && sentTotal - campaign.batchStartAt >= campaign.batchSize) {
    await pause(tenantId, campaignId, "batch_done");
    return "paused";
  }
  return "sending";
}

/** Campaigns the tick should run now. */
export async function dueCampaigns(now = new Date()): Promise<{ id: string; tenantId: string }[]> {
  return prisma.campaign.findMany({
    where: { status: { in: ["scheduled", "sending"] }, scheduledAt: { lte: now } },
    select: { id: true, tenantId: true },
    take: 500,
  });
}
