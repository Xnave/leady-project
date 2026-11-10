import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/leads";
import { createWhatsAppTemplate, listWhatsAppTemplates, zernioConfigured } from "@/lib/zernio";
import {
  CAMPAIGN_TERMS_VERSION,
  settingsFromRow,
  termsAccepted,
  type AdminSettingsPatch,
  type CampaignSettings,
} from "./settings";
import {
  composeTemplate,
  newTemplateName,
  normalizeTemplateStatus,
  templateCreateBody,
  validateTemplate,
  type TemplateDraft,
  type TemplateIssue,
  type TemplateStatusEvent,
} from "./templates";

export async function loadCampaignSettings(tenantId: string): Promise<CampaignSettings> {
  const row = await prisma.tenantCampaignSettings.findUnique({ where: { tenantId } });
  return settingsFromRow(row);
}

/** Nav flag and route gate: the add-on is on for this tenant. */
export async function campaignsEnabled(tenantId: string): Promise<boolean> {
  const row = await prisma.tenantCampaignSettings.findUnique({ where: { tenantId }, select: { enabled: true } });
  return row?.enabled === true;
}

export async function saveAdminSettings(tenantId: string, patch: AdminSettingsPatch): Promise<CampaignSettings> {
  const row = await prisma.tenantCampaignSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...patch },
    update: patch,
  });
  return settingsFromRow(row);
}

export async function acceptCampaignTerms(tenantId: string, actor: string, now = new Date()): Promise<void> {
  await prisma.tenantCampaignSettings.update({
    where: { tenantId },
    data: { termsVersion: CAMPAIGN_TERMS_VERSION, termsAcceptedAt: now, termsAcceptedBy: actor },
  });
}

export type TenantWhatsAppAccount = { accountId: string; phone: string };

/** Footer phone: the connected number campaigns go out from, as the client sees it. */
export function footerPhone(account: TenantWhatsAppAccount | null): string {
  return account ? formatPhoneDisplay(account.phone) || account.phone : "";
}

/**
 * The tenant's own WhatsApp number connected through Zernio. Campaigns never
 * send from the platform number, and demo / local channels do not count.
 */
export async function tenantWhatsAppAccount(tenantId: string): Promise<TenantWhatsAppAccount | null> {
  const channels = await prisma.channelConnection.findMany({
    where: { tenantId, provider: "whatsapp", enabled: true, apiBase: { contains: "zernio" } },
    select: { providerExternalId: true, providerAccountId: true },
    orderBy: { updatedAt: "desc" },
  });
  const live = channels.find(
    (ch) => ch.providerExternalId && !ch.providerExternalId.startsWith("local-") && !ch.providerAccountId.startsWith("demo-"),
  );
  return live?.providerExternalId ? { accountId: live.providerExternalId, phone: live.providerAccountId } : null;
}

export type TemplateRow = {
  id: string;
  title: string;
  name: string;
  language: string;
  category: string;
  body: string;
  examples: string[];
  text: string;
  footer: string;
  buttons: string[];
  status: string;
  statusReason: string;
  submittedAt: string | null;
  submittedBy: string;
};

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

type DbTemplate = Awaited<ReturnType<typeof prisma.whatsAppTemplate.findFirstOrThrow>>;

function toRow(t: DbTemplate): TemplateRow {
  return {
    id: t.id,
    title: t.title,
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    examples: stringArray(t.examples),
    text: t.text,
    footer: t.footer,
    buttons: stringArray(t.buttons),
    status: t.status,
    statusReason: t.statusReason,
    submittedAt: t.submittedAt ? t.submittedAt.toISOString() : null,
    submittedBy: t.submittedBy,
  };
}

export async function listTemplates(tenantId: string): Promise<TemplateRow[]> {
  const rows = await prisma.whatsAppTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return rows.map(toRow);
}

const WAITING = ["PENDING", "IN_APPEAL", "PENDING_DELETION"];
/** Submits with no provider id yet (crash mid-submit, or Zernio returned none) are re-checked for this long. */
const UNCONFIRMED_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A DRAFT Meta still does not list after this long was never received. */
const DRAFT_GIVE_UP_MS = 15 * 60 * 1000;

/**
 * Polling fallback for the status webhook: re-read templates still waiting on
 * Meta, plus recent submits that never got a provider id. One Zernio call per
 * account. Failures leave the stored status as is.
 */
export async function refreshPendingTemplates(tenantId: string, now: Date = new Date()): Promise<void> {
  if (!zernioConfigured()) return;
  const waiting = await prisma.whatsAppTemplate.findMany({
    where: {
      tenantId,
      OR: [
        { status: { in: WAITING } },
        {
          status: { in: ["DRAFT", "FAILED"] },
          providerId: "",
          submittedAt: { gte: new Date(now.getTime() - UNCONFIRMED_WINDOW_MS) },
        },
      ],
    },
  });
  const accounts = [...new Set(waiting.map((t) => t.accountId))];
  for (const accountId of accounts) {
    let live;
    try {
      live = await listWhatsAppTemplates(accountId);
    } catch {
      continue;
    }
    for (const t of waiting.filter((w) => w.accountId === accountId)) {
      const found = live.find((l) => l.name === t.name && l.language === t.language);
      if (!found) {
        const stale = t.status === "DRAFT" && t.submittedAt && now.getTime() - t.submittedAt.getTime() > DRAFT_GIVE_UP_MS;
        if (stale) {
          await prisma.whatsAppTemplate.update({
            where: { id: t.id },
            data: { status: "FAILED", statusReason: "Meta did not receive this template." },
          });
        }
        continue;
      }
      const status = normalizeTemplateStatus(found.status);
      const reason = found.rejectedReason && found.rejectedReason !== "NONE" ? found.rejectedReason : "";
      if (status === t.status && reason === t.statusReason && (found.id || "") === t.providerId) continue;
      await prisma.whatsAppTemplate.update({
        where: { id: t.id },
        data: { status, statusReason: reason, providerId: found.id || t.providerId },
      });
    }
  }
}

/**
 * Webhook path: update the matching template on that number. Unknown templates
 * (digest, other apps) match nothing. Template names are unique per tenant, not
 * globally, so an event without an account id updates nothing.
 */
export async function applyTemplateStatusEvent(e: TemplateStatusEvent): Promise<number> {
  if (!e.accountId) return 0;
  const res = await prisma.whatsAppTemplate.updateMany({
    where: { accountId: e.accountId, name: e.name, language: e.language },
    data: { status: e.status, statusReason: e.reason, ...(e.providerId ? { providerId: e.providerId } : {}) },
  });
  return res.count;
}

export type SubmitResult =
  | { ok: true; template: TemplateRow }
  | { ok: false; error: "not_enabled" | "terms_required" | "no_whatsapp" | "provider_unavailable" }
  | { ok: false; error: "submit_failed"; template: TemplateRow }
  | { ok: false; error: "invalid"; issues: TemplateIssue[] };

/**
 * Saves the template with its locked additions and submits it to Meta. The row
 * stays DRAFT until Zernio returns a template id; only then is it PENDING. A
 * submit failure keeps the row as FAILED with the reason, so the owner sees it,
 * and returns `submit_failed`. A crash mid-submit leaves a DRAFT with
 * `submittedAt` set, which `refreshPendingTemplates` reconciles.
 */
export async function submitTemplate(opts: {
  tenantId: string;
  actor: string;
  draft: TemplateDraft;
  now?: Date;
}): Promise<SubmitResult> {
  const settings = await loadCampaignSettings(opts.tenantId);
  if (!settings.enabled) return { ok: false, error: "not_enabled" };
  if (!termsAccepted(settings)) return { ok: false, error: "terms_required" };
  const account = await tenantWhatsAppAccount(opts.tenantId);
  if (!account) return { ok: false, error: "no_whatsapp" };
  if (!zernioConfigured()) return { ok: false, error: "provider_unavailable" };

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: opts.tenantId }, select: { name: true } });
  const composed = composeTemplate(opts.draft, {
    adPrefixEnabled: settings.adPrefixEnabled,
    businessName: tenant.name,
    businessPhone: footerPhone(account),
  });
  const issues = validateTemplate(opts.draft, composed);
  if (issues.length > 0) return { ok: false, error: "invalid", issues };

  const now = opts.now ?? new Date();
  const name = newTemplateName(now);
  const created = await prisma.whatsAppTemplate.create({
    data: {
      tenantId: opts.tenantId,
      accountId: account.accountId,
      title: opts.draft.title.trim(),
      name,
      language: opts.draft.language,
      category: opts.draft.category,
      body: opts.draft.body.trim(),
      examples: opts.draft.examples.map((e) => e.trim()),
      text: composed.text,
      footer: composed.footer,
      buttons: composed.buttons,
      status: "DRAFT",
      submittedAt: now,
      submittedBy: opts.actor,
    },
  });

  let status: string = "FAILED";
  let statusReason = "";
  let providerId = "";
  try {
    const res = await createWhatsAppTemplate(
      templateCreateBody({ accountId: account.accountId, name, draft: opts.draft, composed }),
    );
    providerId = res?.id?.trim() ?? "";
    if (providerId) {
      status = normalizeTemplateStatus(res?.status ?? "PENDING");
      statusReason = res?.rejectedReason && res.rejectedReason !== "NONE" ? res.rejectedReason : "";
    } else {
      statusReason = "Meta did not return a template id.";
    }
  } catch (err) {
    statusReason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  }
  const saved = await prisma.whatsAppTemplate.update({
    where: { id: created.id },
    data: { status, statusReason, providerId },
  });
  if (status === "FAILED" || !providerId) return { ok: false, error: "submit_failed", template: toRow(saved) };
  return { ok: true, template: toRow(saved) };
}
