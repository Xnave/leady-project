import { z } from "zod";
import { prisma } from "@/lib/db";
import { uiCopy, type UiLang } from "@/lib/ui";
import { parseAudience, parseParamSpecs, previewCampaign, type Preview } from "./engine";
import {
  audienceSchema,
  DECLARATION_VERSION,
  GOALS,
  nextStatus,
  paramSchema,
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
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;

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

async function checkTemplate(tenantId: string, input: CampaignInput): Promise<CampaignError | null> {
  const template = await prisma.whatsAppTemplate.findFirst({ where: { id: input.templateId, tenantId } });
  if (!template) return "template_not_found";
  if (!isSendable(template.status)) return "template_not_approved";
  if (input.params.length !== expectedParamCount(template.body)) return "params_mismatch";
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
  const row = await prisma.campaign.create({ data: { tenantId, createdBy: actor.actorLabel, ...data(parsed.data) } });
  return { id: row.id };
}

export async function updateCampaign(tenantId: string, id: string, raw: unknown): Promise<{ ok: true } | { error: CampaignError; detail?: string }> {
  const denied = await gate(tenantId);
  if (denied) return { error: denied };
  const current = await prisma.campaign.findFirst({ where: { id, tenantId }, select: { status: true } });
  if (!current) return { error: "not_found" };
  if (current.status !== "draft") return { error: "not_draft" };
  const parsed = campaignInputSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalid", detail: parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
  const bad = await checkTemplate(tenantId, parsed.data);
  if (bad) return { error: bad };
  await prisma.campaign.update({ where: { id }, data: data(parsed.data) });
  return { ok: true };
}

export async function previewFor(tenantId: string, id: string): Promise<Preview | { error: CampaignError | "bad_audience" }> {
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId }, include: { template: { select: { category: true } } } });
  if (!campaign) return { error: "not_found" };
  return previewCampaign(campaign);
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
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId }, include: { template: true } });
  if (!campaign) return { error: "not_found" };
  if (campaign.status !== "draft") return { error: "not_draft" };
  if (!isSendable(campaign.template.status)) return { error: "template_not_approved" };
  if (!parseAudience(campaign.audience)) return { error: "invalid" };
  if (parseParamSpecs(campaign.params).length !== expectedParamCount(campaign.template.body)) return { error: "params_mismatch" };
  const preview = await previewCampaign(campaign, now);
  if ("error" in preview) return { error: "invalid" };
  if (preview.eligible === 0) return { error: "no_recipients" };

  const scheduledAt = campaign.scheduledAt && campaign.scheduledAt > now ? campaign.scheduledAt : now;
  const confirmed = await prisma.$transaction(async (tx) => {
    const updated = await tx.campaign.updateMany({
      where: { id, tenantId, status: "draft" },
      data: { status: "scheduled", scheduledAt, confirmedAt: now, confirmedBy: actor.actorLabel },
    });
    if (updated.count === 0) return false;
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
    return true;
  });
  if (!confirmed) return { error: "not_draft" };
  console.log(JSON.stringify({ msg: "campaigns.confirmed", tenantId, campaignId: id, actor: actor.actorLabel, recipients: preview.eligible }));
  return { ok: true, scheduledAt: scheduledAt.toISOString(), recipients: preview.eligible };
}

export async function actOnCampaign(tenantId: string, id: string, action: CampaignAction): Promise<{ status: string } | { error: CampaignError }> {
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
    // A new batch starts from what was already sent.
    extra.batchStartAt = await prisma.campaignSend.count({ where: { campaignId: id, status: { in: ["sent", "sending"] } } });
  }
  const res = await prisma.campaign.updateMany({ where: { id, tenantId, status: campaign.status }, data: { status: next, ...extra } });
  if (res.count === 0) return { error: "bad_transition" };
  if (action === "cancel") {
    await prisma.campaignSend.updateMany({ where: { campaignId: id, status: "queued" }, data: { status: "skipped", skipReason: "canceled" } });
  }
  return { status: next };
}

export type CampaignMetrics = { queued: number; sending: number; sent: number; failed: number; skipped: number };

function emptyMetrics(): CampaignMetrics {
  return { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
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
      take: 100,
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
