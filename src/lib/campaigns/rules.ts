import { z } from "zod";

/**
 * Pure send rules for client campaigns: who is skipped and why, when sending
 * may happen, how many may go out, what it costs, and campaign state changes.
 * No Prisma here, so every rule is unit-tested.
 */

export const DECLARATION_VERSION = "2026-11-06";

/** Nobody gets more than one campaign message from a tenant in this window. */
export const FREQUENCY_CAP_DAYS = 7;
/** A lead who wrote or was answered this recently is mid-conversation. */
export const OPEN_CONVERSATION_DAYS = 3;
/** Pause between two sends inside a run. */
export const SEND_GAP_MS = 250;
/** Upper bound per worker run, on top of the daily ceiling and batch size. */
export const MAX_SENDS_PER_RUN = 300;

/** Meta price per delivered template, USD. Marketing checked 28.10.2026 for Israel; utility is an estimate. */
export const PRICE_USD: Record<string, number> = { MARKETING: 0.041, UTILITY: 0.0053 };

export const LOST_STAGES = new Set(["lost", "not_relevant"]);

// ─── Quiet hours ────────────────────────────────────────────────────────────

/** Local sending window: weekdays 09:00-20:00, Friday 09:00-14:00, never on Saturday. */
export const SEND_WINDOW = {
  startHour: 9,
  endHour: 20,
  fridayEndHour: 14,
} as const;

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(at: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
  };
}

/** Midnight at the start of `at`'s local day, as a UTC instant. */
export function startOfZonedDay(at: Date, tz: string): Date {
  const p = zonedParts(at, tz);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  // Offset of the zone at that moment (handles DST because we re-read it at the guess).
  const g = zonedParts(new Date(guess), tz);
  const offsetMs = Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute) - guess;
  return new Date(guess - offsetMs);
}

export function inSendWindow(at: Date, tz: string): boolean {
  const p = zonedParts(at, tz);
  if (p.weekday === 6) return false;
  if (p.hour < SEND_WINDOW.startHour) return false;
  const end = p.weekday === 5 ? SEND_WINDOW.fridayEndHour : SEND_WINDOW.endHour;
  return p.hour < end;
}

// ─── Who is skipped ─────────────────────────────────────────────────────────

export const SKIP_REASONS = [
  "no_phone",
  "invalid_phone",
  "suppressed",
  "not_allowlisted",
  "frequency_cap",
  "open_conversation",
  "active_case",
  "lost_lead",
  "archived_client",
  "missing_param",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type RecipientState = {
  phone: string;
  phoneStatus: "ok" | "missing" | "invalid";
  suppressed: boolean;
  /** Null when no allow-list applies. */
  allowListed: boolean | null;
  /** Last campaign message from this tenant (any other campaign) to this phone. */
  lastCampaignSentAt: Date | null;
  lastConversationAt: Date | null;
  conversationOpen: boolean;
  activeCase: boolean;
  leadStage: string | null;
  archived: boolean;
};

export function skipReasonFor(s: RecipientState, now: Date): SkipReason | null {
  if (s.phoneStatus === "missing" || (!s.phone && s.phoneStatus === "ok")) return "no_phone";
  if (s.phoneStatus === "invalid") return "invalid_phone";
  if (s.suppressed) return "suppressed";
  if (s.allowListed === false) return "not_allowlisted";
  const day = 24 * 3600 * 1000;
  if (s.lastCampaignSentAt && now.getTime() - s.lastCampaignSentAt.getTime() < FREQUENCY_CAP_DAYS * day) return "frequency_cap";
  if (s.conversationOpen && s.lastConversationAt && now.getTime() - s.lastConversationAt.getTime() < OPEN_CONVERSATION_DAYS * day) {
    return "open_conversation";
  }
  if (s.activeCase) return "active_case";
  if (s.leadStage && LOST_STAGES.has(s.leadStage)) return "lost_lead";
  if (s.archived) return "archived_client";
  return null;
}

/** Truthy flag values a CRM uses for "archived". */
export function isArchivedValue(value: unknown): boolean {
  const v = value == null ? "" : String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

/**
 * Phones allowed to receive campaign messages when the allow-list applies:
 * always outside production, and in production while `CAMPAIGN_ALLOWLIST_ONLY`
 * is on (the pilot's test-send step). Null = no allow-list.
 */
export function allowList(env: { production: boolean; list: string; only: string }): Set<string> | null {
  const enforced = !env.production || env.only === "1" || env.only.toLowerCase() === "true";
  if (!enforced) return null;
  return new Set(
    env.list
      .split(",")
      .map((p) => p.replace(/\D/g, ""))
      .filter(Boolean),
  );
}

// ─── How many may go out ────────────────────────────────────────────────────

export function sendBudget(opts: {
  dailyCeiling: number;
  sentToday: number;
  batchSize: number | null;
  sentInBatch: number;
}): { budget: number; limitedBy: "daily_ceiling" | "batch" | "run" | null } {
  const daily = Math.max(0, opts.dailyCeiling - opts.sentToday);
  const batch = opts.batchSize == null ? Infinity : Math.max(0, opts.batchSize - opts.sentInBatch);
  const budget = Math.min(daily, batch, MAX_SENDS_PER_RUN);
  if (budget > 0) return { budget, limitedBy: null };
  return { budget: 0, limitedBy: daily === 0 ? "daily_ceiling" : batch === 0 ? "batch" : "run" };
}

export function estimateCostUsd(recipients: number, category: string): number {
  const price = PRICE_USD[category] ?? PRICE_USD.MARKETING;
  return Math.round(recipients * price * 100) / 100;
}

// ─── Template variables ─────────────────────────────────────────────────────

export const PARAM_SOURCES = ["first_name", "full_name", "business_name", "text"] as const;
export type ParamSource = (typeof PARAM_SOURCES)[number];

export const paramSchema = z.object({
  source: z.enum(PARAM_SOURCES),
  /** Fixed text for `text`; ignored otherwise. */
  value: z.string().max(200).default(""),
  /** Used when the recipient has no name. */
  fallback: z.string().max(200).default(""),
});
export type ParamSpec = z.infer<typeof paramSchema>;

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** Values for {{1}}..{{n}} in order, or null when one would be empty (Meta rejects empty params). */
export function resolveParams(specs: ParamSpec[], who: { name: string; businessName: string }): string[] | null {
  const out: string[] = [];
  for (const spec of specs) {
    let v = "";
    if (spec.source === "first_name") v = firstName(who.name);
    else if (spec.source === "full_name") v = who.name.trim();
    else if (spec.source === "business_name") v = who.businessName.trim();
    else v = spec.value.trim();
    if (!v) v = spec.fallback.trim();
    if (!v) return null;
    out.push(v.slice(0, 200));
  }
  return out;
}

// ─── Audience ───────────────────────────────────────────────────────────────

export const CONFIDENCES = ["high", "medium_high", "medium", "low"] as const;

export const audienceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clients"),
    /** Deal at least this many years ago (e.g. 4.5). */
    dealYearsAgoMin: z.number().min(0).max(60).nullable().default(null),
    /** Deal at most this many years ago (e.g. 10). */
    dealYearsAgoMax: z.number().min(0).max(60).nullable().default(null),
    /** Allowed deal-date confidence levels; empty = any. */
    confidence: z.array(z.enum(CONFIDENCES)).default([]),
    /** Also include clients with no deal date (only when no year range is set). */
    includeNoDealDate: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("leads"),
    leadIds: z.array(z.string().min(1)).min(1).max(2000),
  }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export function dealDateRange(a: Extract<Audience, { kind: "clients" }>, now: Date): { gte?: Date; lte?: Date } {
  const yearMs = 365.25 * 24 * 3600 * 1000;
  const range: { gte?: Date; lte?: Date } = {};
  if (a.dealYearsAgoMin != null) range.lte = new Date(now.getTime() - a.dealYearsAgoMin * yearMs);
  if (a.dealYearsAgoMax != null) range.gte = new Date(now.getTime() - a.dealYearsAgoMax * yearMs);
  return range;
}

// ─── Campaign state ─────────────────────────────────────────────────────────

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "done", "canceled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type CampaignAction = "pause" | "resume" | "cancel";

export function nextStatus(current: string, action: CampaignAction): CampaignStatus | null {
  if (action === "cancel") return ["draft", "scheduled", "sending", "paused"].includes(current) ? "canceled" : null;
  if (action === "pause") return current === "scheduled" || current === "sending" ? "paused" : null;
  if (action === "resume") return current === "paused" ? "scheduled" : null;
  return null;
}

export const GOALS = ["handoff", "book"] as const;
