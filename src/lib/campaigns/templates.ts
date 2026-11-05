/**
 * Tenant WhatsApp templates for client campaigns: what the owner writes, what
 * Meta receives, and the rules between them. Pure - no DB, no network.
 *
 * Marketing templates always carry the locked additions: the "פרסומת" prefix
 * (Communications Law 30A(e), unless a platform admin turned it off with a
 * recorded legal note), a footer with the business name and phone, and three
 * quick-reply buttons whose last one is the opt-out. The owner edits only the
 * body, so none of these can be removed from the editor.
 */

export type TemplateLanguage = "he" | "en";
export type TemplateCategory = "MARKETING" | "UTILITY";

export const TEMPLATE_LANGUAGES: readonly TemplateLanguage[] = ["he", "en"];
export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = ["MARKETING", "UTILITY"];

export const AD_PREFIX = "פרסומת";
const AD_SEPARATOR = " | ";

/** Interested / not now / opt-out, in that order. Replies are routed by position (PR 4). */
export const LOCKED_BUTTONS: Record<TemplateLanguage, readonly [string, string, string]> = {
  he: ["מעוניין/ת", "לא עכשיו", "הסרה"],
  en: ["Interested", "Not now", "Unsubscribe"],
};

/** Meta limits. */
export const BODY_MAX = 1024;
export const FOOTER_MAX = 60;
export const BUTTON_MAX = 25;
export const TITLE_MAX = 80;

export type TemplateDraft = {
  title: string;
  category: TemplateCategory;
  language: TemplateLanguage;
  body: string;
  /** Example value per {{n}}, in order. Meta reviews the template with these. */
  examples: string[];
};

export type ComposedTemplate = { text: string; footer: string; buttons: string[] };

export type TemplateIssue =
  | "title_required"
  | "title_too_long"
  | "body_required"
  | "body_too_long"
  | "variables_not_sequential"
  | "example_missing"
  | "variable_at_start"
  | "variable_at_end"
  | "prefix_in_body";

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

/** Distinct variable numbers in order of first appearance. */
export function templateVariables(body: string): number[] {
  const seen: number[] = [];
  for (const m of body.matchAll(VAR_RE)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

export function hasAdPrefix(d: Pick<TemplateDraft, "category">, adPrefixEnabled: boolean): boolean {
  return d.category === "MARKETING" && adPrefixEnabled;
}

/** Business name and phone, cut to Meta's 60-character footer. The phone goes first when space runs out. */
export function footerLine(businessName: string, businessPhone: string): string {
  const name = businessName.trim();
  const phone = businessPhone.trim();
  const both = name && phone ? `${name} · ${phone}` : name || phone;
  if (both.length <= FOOTER_MAX) return both;
  if (name.length <= FOOTER_MAX) return name;
  return `${name.slice(0, FOOTER_MAX - 1)}…`;
}

/** The message Meta receives. Locked parts are added here, never taken from the owner. */
export function composeTemplate(
  d: Pick<TemplateDraft, "category" | "language" | "body">,
  opts: { adPrefixEnabled: boolean; businessName: string; businessPhone: string },
): ComposedTemplate {
  const body = d.body.trim();
  if (d.category !== "MARKETING") return { text: body, footer: "", buttons: [] };
  return {
    text: hasAdPrefix(d, opts.adPrefixEnabled) ? `${AD_PREFIX}${AD_SEPARATOR}${body}` : body,
    footer: footerLine(opts.businessName, opts.businessPhone),
    buttons: [...LOCKED_BUTTONS[d.language]],
  };
}

export function validateTemplate(d: TemplateDraft, composed: ComposedTemplate): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const title = d.title.trim();
  const body = d.body.trim();
  if (!title) issues.push("title_required");
  else if (title.length > TITLE_MAX) issues.push("title_too_long");
  if (!body) {
    issues.push("body_required");
    return issues;
  }
  if (composed.text.length > BODY_MAX) issues.push("body_too_long");
  // The owner should not type the label themselves; it would appear twice.
  if (body.startsWith(AD_PREFIX)) issues.push("prefix_in_body");

  // {{1}}, {{2}}, ... in order of first appearance, no gaps.
  const vars = templateVariables(body);
  if (vars.some((n, i) => n !== i + 1)) issues.push("variables_not_sequential");
  if (vars.length > 0) {
    for (let i = 0; i < vars.length; i++) {
      if (!(d.examples[i] ?? "").trim()) {
        issues.push("example_missing");
        break;
      }
    }
  }
  // Meta rejects a body that starts or ends with a variable.
  if (/^\{\{\s*\d+\s*\}\}/.test(composed.text)) issues.push("variable_at_start");
  if (/\{\{\s*\d+\s*\}\}[\s.!?…]*$/.test(composed.text)) issues.push("variable_at_end");
  return issues;
}

/** Meta template name: lowercase, digits, underscores, starting with a letter. Unique per tenant. */
export function newTemplateName(now: Date = new Date(), rand: () => number = Math.random): string {
  const suffix = Math.floor(rand() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `zc_${now.getTime().toString(36)}_${suffix}`;
}

/** Body for Zernio `POST /v1/whatsapp/templates`. */
export function templateCreateBody(opts: {
  accountId: string;
  name: string;
  draft: Pick<TemplateDraft, "category" | "language" | "body" | "examples">;
  composed: ComposedTemplate;
}) {
  const { draft, composed } = opts;
  const n = templateVariables(draft.body).length;
  const components: Record<string, unknown>[] = [
    n > 0
      ? { type: "BODY", text: composed.text, example: { body_text: [draft.examples.slice(0, n).map((e) => e.trim())] } }
      : { type: "BODY", text: composed.text },
  ];
  if (composed.footer) components.push({ type: "FOOTER", text: composed.footer });
  if (composed.buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: composed.buttons.map((text) => ({ type: "QUICK_REPLY", text })) });
  }
  return {
    accountId: opts.accountId,
    name: opts.name,
    category: draft.category,
    language: draft.language,
    components,
  };
}

/** Preview text with the examples filled in. */
export function previewText(text: string, examples: string[]): string {
  return text.replace(VAR_RE, (whole, n: string) => examples[Number(n) - 1]?.trim() || whole);
}

export const TEMPLATE_STATUSES = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "IN_APPEAL",
  "PAUSED",
  "DISABLED",
  "PENDING_DELETION",
  "FAILED",
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export function normalizeTemplateStatus(raw: unknown): TemplateStatus {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return (TEMPLATE_STATUSES as readonly string[]).includes(s) ? (s as TemplateStatus) : "PENDING";
}

/** Only an approved template can be picked for a campaign. */
export function isSendable(status: string): boolean {
  return status === "APPROVED";
}

export type TemplateStatusEvent = {
  accountId: string;
  name: string;
  language: string;
  status: TemplateStatus;
  reason: string;
  providerId: string;
};

/** Zernio `whatsapp.template.status_updated`. Anything else returns null. */
export function parseTemplateStatusEvent(payload: unknown): TemplateStatusEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.event !== "whatsapp.template.status_updated") return null;
  const t = (root.template && typeof root.template === "object" ? root.template : {}) as Record<string, unknown>;
  const account = (root.account && typeof root.account === "object" ? root.account : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const name = str(t.name);
  const language = str(t.language);
  if (!name || !language) return null;
  const reason = str(t.reason);
  return {
    accountId: str(account.id) || str(account._id) || str(root.accountId),
    name,
    language,
    status: normalizeTemplateStatus(t.status),
    reason: reason === "NONE" ? "" : reason,
    providerId: str(t.templateId) || str(t.id),
  };
}
