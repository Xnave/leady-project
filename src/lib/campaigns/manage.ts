import { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeClientPhone } from "@/lib/client-sources/phone";
import { prisma } from "@/lib/db";
import { uiCopy, type UiLang } from "@/lib/ui";
import { freezeAudience, fillAudienceMessage, pageAudience, parseAudience, parseParamSpecs, previewCampaign, type Preview } from "./engine";
import {
  audienceSchema,
  DECLARATION_VERSION,
  CAMPAIGN_SEND_GAP_DEFAULT_MS,
  CAMPAIGN_SEND_GAP_MAX_MS,
  CAMPAIGN_SEND_GAP_MIN_MS,
  documentsFollowUps,
  followUpStepSchema,
  GOALS,
  nextStatus,
  paramSchema,
  sendWindowSchema,
  type CampaignAction,
} from "./rules";
import { loadCampaignSettings } from "./store";
import { termsAccepted } from "./settings";
import { isSendable, templateVariables } from "./templates";

/**
 * Campaign lifecycle for owners: draft → confirm (with the declaration) →
 * scheduled → sending → done, plus pause / resume / cancel. Every query is
 * scoped by tenantId.
 */

export type Actor = { actorUserId: string; actorLabel: string };

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  templateId: z.string().min(1),
  audience: audienceSchema,
  params: z.array(paramSchema).max(20).default([]),
  goal: z.enum(GOALS).default("handoff"),
  brief: z.string().trim().max(2000).default(""),
  batchSize: z.number().int().min(1).max(100_000).nullable().default(null),
  /** ISO time; null = as soon as it is confirmed. */
  scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
  /** Null keeps the Israeli default. */
  sendWindow: sendWindowSchema.nullable().default(null),
  /** Empty keeps a single send. A reminder template becomes one reminder, then one advisor task. */
  followUps: z.array(followUpStepSchema).max(4).default([]),
  /** Shorthand for the documents sequence: reminder template, then a task. */
  reminderTemplateId: z.string().min(1).nullable().default(null),
  /** Hours of silence before the reminder, and again before the task. */
  followUpHours: z.number().int().min(1).max(24 * 30).default(48),
  /** Milliseconds between recipients. Defaults to 30 seconds. */
  sendGapMs: z.number().int().min(CAMPAIGN_SEND_GAP_MIN_MS).max(CAMPAIGN_SEND_GAP_MAX_MS).default(CAMPAIGN_SEND_GAP_DEFAULT_MS),
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const confirmBodySchema = z.object({
  declarationAccepted: z.literal(true),
  declarationVersion: z.literal(DECLARATION_VERSION),
  language: z.enum(["he", "en"]),
});

export const actionBodySchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

export type CampaignError =
  | "not_enabled"
  | "terms_required"
  | "invalid"
  | "template_not_found"
  | "template_not_approved"
  | "params_mismatch"
  | "not_found"
  | "not_draft"
  | "declaration_required"
  | "no_recipients"
  | "audience_too_large"
  | "bad_transition";

async function gate(tenantId: string): Promise<CampaignError | null> {
  const settings = await loadCampaignSettings(tenantId);
  if (!settings.enabled) return "not_enabled";
  if (!termsAccepted(settings)) return "terms_required";
  return null;
}

/** Params must cover {{1}}..{{n}} of the chosen template exactly. */
export function expectedParamCount(body: string): number {
  const vars = templateVariables(body);
  return vars.length ? Math.max(...vars) : 0;
}

function stepsOf(input: CampaignInput) {
  if (input.reminderTemplateId) return documentsFollowUps(input.reminderTemplateId, input.followUpHours * 60 * 60 * 1000);
  return input.followUps.filter((step) => step.onSilence === "escalate" || step.templateId);
}

async function checkTemplate(tenantId: string, input: CampaignInput): Promise<CampaignError | null> {
  const template = await prisma.whatsAppTemplate.findFirst({ where: { id: input.templateId, tenantId } });
  if (!template) return "template_not_found";
  if (!isSendable(template.status)) return "template_not_approved";
  if (input.params.length !== expectedParamCount(template.body)) return "params_mismatch";
  for (const step of stepsOf(input)) {
    if (!step.templateId) continue;
    const follow = await prisma.whatsAppTemplate.findFirst({ where: { id: step.templateId, tenantId } });
    if (!follow) return "template_not_found";
    if (!isSendable(follow.status)) return "template_not_approved";
    if (input.params.length !== expectedParamCount(follow.body)) return "params_mismatch";
  }
  return null;
}

/** A specific source must belong to this tenant. "all" and a frozen audience do not name one. */
async function checkAudience(tenantId: string, input: CampaignInput): Promise<CampaignError | null> {
  if (input.audience.kind !== "clients") return null;
  const sourceId = input.audience.sourceId;
  if (!sourceId || sourceId === "all") return null;
  const found = await prisma.clientSource.count({ where: { id: sourceId, tenantId } });
  if (!found) return "invalid";
  return null;
}

function data(input: CampaignInput) {
  return {
    name: input.name,
    templateId: input.templateId,
    audience: input.audience,
    params: input.params,
    goal: input.goal,
    brief: input.brief,
    batchSize: input.batchSize,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
    sendWindow: input.sendWindow ?? Prisma.DbNull,
    sendGapMs: input.sendGapMs,
    followUps: stepsOf(input),
  };
}

export async function createCampaign(
  tenantId: string,
  actor: Actor,
  raw: unknown,
): Promise<{ id: string } | { error: CampaignError; detail?: string }> {
  const denied = await gate(tenantId);
  if (denied) return { error: denied };
  const parsed = campaignInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid", detail: parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
  const bad = await checkTemplate(tenantId, parsed.data);
  if (bad) return { error: bad };
  const badAudience = await checkAudience(tenantId, parsed.data);
  if (badAudience) return { error: badAudience };
  const row = await prisma.campaign.create({ data: { tenantId, createdBy: actor.actorLabel, ...data(parsed.data) } });
  return { id: row.id };
}

export async function updateCampaign(tenantId: string, id: string, raw: unknown): Promise<{ ok: true } | { error: CampaignError; detail?: string }> {
  const denied = await gate(tenantId);
  if (denied) return { error: denied };
  const current = await prisma.campaign.findFirst({ where: { id, tenantId }, select: { status: true } });
  if (!current) return { error: "not_found" };
  if (!["draft", "paused", "scheduled", "sending"].includes(current.status)) return { error: "not_draft" };
  const parsed = campaignInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid", detail: parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
  const bad = await checkTemplate(tenantId, parsed.data);
  if (bad) return { error: bad };
  const badAudience = await checkAudience(tenantId, parsed.data);
  if (badAudience) return { error: badAudience };
  const res = await prisma.campaign.updateMany({ where: { id, tenantId, status: current.status }, data: data(parsed.data) });
  if (res.count === 0) return { error: "not_draft" };
  return { ok: true };
}

export async function previewFor(tenantId: string, id: string): Promise<Preview | { error: CampaignError | "bad_audience" }> {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId }, include: { template: { select: { category: true } } } });
  if (!campaign) return { error: "not_found" };
  return previewCampaign(campaign);
}

const templateText = { select: { category: true, text: true, body: true } } as const;

export async function audiencePage(
  tenantId: string,
  id: string,
  opts: { cursor?: string; reason?: "not_allowlisted" | null },
) {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId }, include: { template: templateText } });
  if (!campaign) return { error: "not_found" as const };
  return pageAudience(campaign, opts);
}

export async function previewRecipient(
  tenantId: string,
  id: string,
  who: { contactId?: string | null; leadId?: string | null },
  paramsOverride?: unknown,
) {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId }, include: { template: templateText } });
  if (!campaign) return { error: "not_found" as const };
  return fillAudienceMessage(campaign, who, new Date(), paramsOverride);
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Remember one audience phone on the tenant test list. The caller sends an id, not the number. */
export async function allowAudiencePhone(
  tenantId: string,
  who: { contactId?: string | null; leadId?: string | null },
): Promise<{ ok: true } | { error: "not_found" | "no_phone" }> {
  let phone = "";
  if (who.contactId) {
    const row = await prisma.contact.findFirst({
      where: { id: who.contactId, tenantId },
      select: { phone: true, phoneStatus: true },
    });
    if (!row) return { error: "not_found" };
    if (row.phoneStatus !== "ok") return { error: "no_phone" };
    phone = digits(row.phone);
  } else if (who.leadId) {
    const row = await prisma.lead.findFirst({
      where: { id: who.leadId, tenantId },
      select: { externalUserId: true, fields: true, channel: { select: { provider: true } } },
    });
    if (!row) return { error: "not_found" };
    const fromWhatsApp = row.channel.provider === "whatsapp" ? digits(row.externalUserId) : "";
    if (fromWhatsApp.length >= 10) phone = fromWhatsApp;
    else {
      const raw = (row.fields as { phone?: unknown } | null)?.phone;
      const normalized = normalizeClientPhone(raw, "972");
      if (normalized.status !== "ok") return { error: "no_phone" };
      phone = normalized.phone;
    }
  } else return { error: "not_found" };
  if (phone.length < 10) return { error: "no_phone" };
  await prisma.campaignAllowPhone.upsert({
    where: { tenantId_phone: { tenantId, phone } },
    create: { tenantId, phone },
    update: {},
  });
  return { ok: true };
}

export function declarationText(lang: UiLang): string {
  return uiCopy(lang).campaigns.run.declaration;
}

/**
 * The owner confirms: the declaration is stored with its text and version in
 * the same transaction that schedules the campaign. No declaration, no send.
 */
export async function confirmCampaign(
  tenantId: string,
  id: string,
  actor: Actor,
  body: { declarationAccepted?: unknown; declarationVersion?: unknown; language?: unknown },
  now = new Date(),
): Promise<{ ok: true; scheduledAt: string; recipients: number } | { error: CampaignError }> {
  const denied = await gate(tenantId);
  if (denied) return { error: denied };
  if (body.declarationAccepted !== true || body.declarationVersion !== DECLARATION_VERSION) return { error: "declaration_required" };
  const lang: UiLang = body.language === "en" ? "en" : "he";
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId }, include: { template: true, tenant: { select: { name: true } } } });
  if (!campaign) return { error: "not_found" };
  if (campaign.status !== "draft") return { error: "not_draft" };
  if (!isSendable(campaign.template.status)) return { error: "template_not_approved" };
  if (!parseAudience(campaign.audience)) return { error: "invalid" };
  if (parseParamSpecs(campaign.params).length !== expectedParamCount(campaign.template.body)) return { error: "params_mismatch" };
  const preview = await previewCampaign(campaign, now);
  if ("error" in preview) return { error: preview.error === "audience_too_large" ? "audience_too_large" : "invalid" };
  if (preview.eligible === 0) return { error: "no_recipients" };

  const scheduledAt = campaign.scheduledAt && campaign.scheduledAt > now ? campaign.scheduledAt : now;
  const confirmed = await prisma.$transaction(
    async (tx) => {
      const frozen = await freezeAudience(tx, campaign, now);
      if (frozen === "audience_too_large") return "audience_too_large" as const;
      if (frozen) return "invalid" as const;
      const updated = await tx.campaign.updateMany({
        where: { id, tenantId, status: "draft" },
        data: { status: "scheduled", scheduledAt, confirmedAt: now, confirmedBy: actor.actorLabel, materializedAt: now },
      });
      if (updated.count === 0) return "not_draft" as const;
      await tx.ownerDeclaration.create({
        data: {
          tenantId,
          campaignId: id,
          actorUserId: actor.actorUserId,
          actorLabel: actor.actorLabel,
          textVersion: DECLARATION_VERSION,
          text: declarationText(lang),
          language: lang,
          recipientCount: preview.eligible,
        },
      });
      return null;
    },
    { timeout: 20_000 },
  );
  if (confirmed) return { error: confirmed };
  console.log(JSON.stringify({ msg: "campaigns.confirmed", tenantId, campaignId: id, actor: actor.actorLabel, recipients: preview.eligible }));
  return { ok: true, scheduledAt: scheduledAt.toISOString(), recipients: preview.eligible };
}

export async function actOnCampaign(
  tenantId: string,
  id: string,
  action: CampaignAction,
): Promise<{ status: string; scheduledAt: string | null } | { error: CampaignError }> {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!campaign) return { error: "not_found" };
  const next = nextStatus(campaign.status, action);
  if (!next) return { error: "bad_transition" };
  if (action === "resume") {
    const denied = await gate(tenantId);
    if (denied) return { error: denied };
  }
  const extra: Record<string, unknown> = {};
  if (action === "pause") extra.pauseReason = "owner";
  if (action === "resume") {
    extra.pauseReason = "";
    // The next run samples the sent count. Sampling here would miss a row the previous run already claimed.
    extra.resetBatch = true;
  }
  const res = await prisma.campaign.updateMany({ where: { id, tenantId, status: campaign.status }, data: { status: next, ...extra } });
  if (res.count === 0) return { error: "bad_transition" };
  if (action === "cancel") {
    await prisma.campaignSend.updateMany({ where: { campaignId: id, tenantId, status: "queued" }, data: { status: "skipped", skipReason: "canceled" } });
  }
  return { status: next, scheduledAt: campaign.scheduledAt?.toISOString() ?? null };
}

export type CampaignMetrics = { queued: number; sending: number; sent: number; failed: number; skipped: number; unknown: number };

function emptyMetrics(): CampaignMetrics {
  return { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, unknown: 0 };
}

export async function listCampaigns(tenantId: string) {
  const [rows, counts] = await Promise.all([
    prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: { template: { select: { title: true } } },
      take: 200,
    }),
    prisma.campaignSend.groupBy({ by: ["campaignId", "status"], where: { tenantId }, _count: { _all: true } }),
  ]);
  const metrics = new Map<string, CampaignMetrics>();
  for (const c of counts) {
    const m = metrics.get(c.campaignId) ?? emptyMetrics();
    if (c.status in m) m[c.status as keyof CampaignMetrics] = c._count._all;
    metrics.set(c.campaignId, m);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    pauseReason: r.pauseReason,
    waitReason: r.waitReason,
    templateTitle: r.template.title,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    sendWindow: r.sendWindow,
    createdAt: r.createdAt.toISOString(),
    metrics: metrics.get(r.id) ?? emptyMetrics(),
  }));
}
export type CampaignListRow = Awaited<ReturnType<typeof listCampaigns>>[number];

export async function campaignDetail(tenantId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, tenantId },
    include: { template: true, declaration: true },
  });
  if (!campaign) return null;
  const [byStatus, byReason, recent] = await Promise.all([
    prisma.campaignSend.groupBy({ by: ["status"], where: { campaignId: id, tenantId }, _count: { _all: true } }),
    prisma.campaignSend.groupBy({ by: ["skipReason"], where: { campaignId: id, tenantId, status: "skipped" }, _count: { _all: true } }),
    prisma.campaignSend.findMany({
      where: { campaignId: id, tenantId },
      orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
      take: 5000,
      select: { id: true, name: true, phone: true, status: true, skipReason: true, error: true, sentAt: true, leadId: true },
    }),
  ]);
  const metrics = emptyMetrics();
  for (const s of byStatus) if (s.status in metrics) metrics[s.status as keyof CampaignMetrics] = s._count._all;
  return {
    campaign,
    metrics,
    skipReasons: Object.fromEntries(byReason.map((r) => [r.skipReason, r._count._all])) as Record<string, number>,
    recent,
  };
}
