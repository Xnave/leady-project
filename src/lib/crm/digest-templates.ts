/**
 * The WhatsApp templates the daily digest can be sent with - one per sector,
 * so a guesthouse owner reads "booking requests waiting for you" and a clinic
 * reads "appointment requests". They live on the Zapidly platform number's
 * WABA and are shared by every tenant in that sector; only the params change
 * per owner.
 *
 * This file is the source of truth for the text Meta reviews:
 * `scripts/digest-templates.ts submit` sends these definitions to Zernio, and
 * the sender picks one by `Tenant.digestSector` (or the tenant's capabilities
 * when that is empty). Changing a body means submitting a new `name` - an
 * approved template's text can't be swapped in place.
 */
import { sanitizeTemplateParam, type Digest } from "./digest";

export const DIGEST_SECTORS = ["general", "hospitality", "appointments"] as const;
export type DigestSector = (typeof DIGEST_SECTORS)[number];

export type DigestTemplate = {
  sector: DigestSector;
  /** Meta template name: lowercase letters, digits, underscores. */
  name: string;
  language: "he";
  category: "UTILITY";
  /** Positional `{{n}}` body; never starts or ends with a variable (Meta rule). */
  body: string;
  footer: string;
  /** Quick-reply button; tapping it opens the 24h window and gets the full list. */
  button: string;
  /** One example per variable, for Meta's reviewers. */
  example: string[];
};

const FOOTER = "להפסקת הסיכום השיבו: הסר";
const BUTTON = "הצג רשימה מלאה";
/** Last body line; the free-text copy swaps it for a link (see `digestTemplateText`). */
const BUTTON_LINE = "לרשימה המלאה לחצו על הכפתור.";

/**
 * Variables, same order in every sector: {{1}} business name, {{2}} awaiting
 * approval, {{3}} handed to the owner, {{4}} follow-ups (reminders + cold),
 * {{5}} the most urgent lead.
 */
export const DIGEST_TEMPLATES: Record<DigestSector, DigestTemplate> = {
  general: {
    sector: "general",
    name: "zapidly_digest_general_v1",
    language: "he",
    category: "UTILITY",
    body: [
      "בוקר טוב {{1}}, זה הסיכום היומי שלך מ-Zapidly.",
      "",
      "ממתינים לאישורך: {{2}}",
      "פניות שהועברו אליך: {{3}}",
      "מעקבים להיום: {{4}}",
      "",
      "הכי דחוף: {{5}}",
      "",
      BUTTON_LINE,
    ].join("\n"),
    footer: FOOTER,
    button: BUTTON,
    example: ["סטודיו נועה", "2", "1", "3", "יוסי כהן · מחכה לאישור"],
  },
  hospitality: {
    sector: "hospitality",
    name: "zapidly_digest_hospitality_v1",
    language: "he",
    category: "UTILITY",
    body: [
      "בוקר טוב {{1}}, זה הסיכום היומי של המתחם שלך מ-Zapidly.",
      "",
      "בקשות הזמנה שממתינות לאישורך: {{2}}",
      "אורחים שמחכים לתשובה ממך: {{3}}",
      "אורחים לחזור אליהם היום: {{4}}",
      "",
      "הכי דחוף: {{5}}",
      "",
      BUTTON_LINE,
    ].join("\n"),
    footer: FOOTER,
    button: BUTTON,
    example: ["צימרי הגליל", "2", "1", "3", "יוסי כהן · 12-14/11, 2 לילות"],
  },
  appointments: {
    sector: "appointments",
    name: "zapidly_digest_appointments_v1",
    language: "he",
    category: "UTILITY",
    body: [
      "בוקר טוב {{1}}, זה הסיכום היומי של העסק שלך מ-Zapidly.",
      "",
      "בקשות לתור שממתינות לאישורך: {{2}}",
      "לקוחות שמחכים לתשובה ממך: {{3}}",
      "לקוחות לחזור אליהם היום: {{4}}",
      "",
      "הכי דחוף: {{5}}",
      "",
      BUTTON_LINE,
    ].join("\n"),
    footer: FOOTER,
    button: BUTTON,
    example: ["קליניקת שקד", "2", "1", "3", "יוסי כהן · יום ג׳ 10:00"],
  },
};

export function isDigestSector(v: unknown): v is DigestSector {
  return typeof v === "string" && (DIGEST_SECTORS as readonly string[]).includes(v);
}

/**
 * The tenant's sector: the explicit choice when set, otherwise inferred from
 * enabled capabilities. Only `reservations` implies a sector on its own -
 * every inbox tenant gets a booking instance by default, so booking alone
 * says nothing about the business.
 */
export function resolveDigestSector(
  chosen: string,
  capabilities: { capabilityId: string; enabled: boolean }[],
): DigestSector {
  if (isDigestSector(chosen)) return chosen;
  if (capabilities.some((c) => c.enabled && c.capabilityId === "reservations")) return "hospitality";
  return "general";
}

/** Params in the order every sector's body uses them. */
export function digestTemplateParams(d: Digest, businessName: string): string[] {
  return [
    sanitizeTemplateParam(businessName, 40),
    String(d.counts.approval),
    String(d.counts.handoff),
    String(d.counts.reminder + d.counts.cold),
    sanitizeTemplateParam([d.top.name, d.top.stand.trim()].filter(Boolean).join(" · "), 80),
  ];
}

/**
 * The template's wording as a free-text message, for an owner whose 24h
 * window is open. A free-text message has no button, so the button line
 * becomes the link to the full list.
 */
export function digestTemplateText(t: DigestTemplate, params: string[], appUrl: string): string {
  const body = t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
  const link = `לרשימה המלאה: ${appUrl.replace(/\/$/, "")}/leads?tab=needs`;
  return [body.replace(BUTTON_LINE, link), "", t.footer].join("\n");
}

/**
 * The template to send: the sector's own when Meta approved it, else the
 * general one, else null (the caller falls back to free text in an open
 * window, or waits for the owner to write).
 */
export function pickDigestTemplate(sector: DigestSector, approved: ReadonlySet<string>): DigestTemplate | null {
  for (const t of [DIGEST_TEMPLATES[sector], DIGEST_TEMPLATES.general]) {
    if (approved.has(templateKey(t.name, t.language))) return t;
  }
  return null;
}

export function templateKey(name: string, language: string): string {
  return `${name}:${language}`;
}

/** Body for Zernio's `POST /v1/whatsapp/templates`. */
export function templateCreateBody(t: DigestTemplate, accountId: string) {
  return {
    accountId,
    name: t.name,
    category: t.category,
    language: t.language,
    components: [
      { type: "BODY", text: t.body, example: { body_text: [t.example] } },
      { type: "FOOTER", text: t.footer },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: t.button }] },
    ],
  };
}
