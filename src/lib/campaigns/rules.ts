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
/** Default pause between two sends inside a run. A tenant can override it. */
export const SEND_GAP_MS = 250;
/** Default upper bound per worker run, on top of the daily ceiling and batch size. A tenant can override it. */
export const MAX_SENDS_PER_RUN = 300;
/** How many recipients one durable chunk claims. */
export const CHUNK_SIZE = 20;
/** How many due campaigns one tick enqueues. Independent of the send budget. */
export const DUE_CAMPAIGNS_PER_TICK = 500;
/** A claim this old never recorded a result. It becomes unknown and is not sent again. */
export const STUCK_SENDING_MS = 15 * 60 * 1000;
/** Silence before the next follow-up step. The documents reminder uses this. */
export const FOLLOW_UP_DELAY_MS = 48 * 60 * 60 * 1000;

/** Steps a run needs so the loop matches whatever budget prepare returned. */
export function runStepCeiling(budget: number, chunkSize = CHUNK_SIZE): number {
  if (chunkSize <= 0) return 0;
  return Math.ceil(budget / chunkSize);
}

/** Meta price per delivered template, USD. Marketing checked 28.10.2026 for Israel; utility is an estimate. */
export const PRICE_USD: Record<string, number> = { MARKETING: 0.041, UTILITY: 0.0053 };

export const LOST_STAGES = new Set(["lost", "not_relevant"]);

// ─── Quiet hours ────────────────────────────────────────────────────────────

/** One open range on one weekday. Minutes are from local midnight. A missing weekday is closed. */
export type DayWindow = { weekday: number; startMinute: number; endMinute: number };

/** Which weekdays are open, each with its own range. Nothing here is special about Friday or Saturday. */
export type SendWindow = { days: DayWindow[] };

const MINUTES_PER_DAY = 24 * 60;

function dayWindow(weekday: number, startHour: number, endHour: number): DayWindow {
  return { weekday, startMinute: startHour * 60, endMinute: endHour * 60 };
}

/** Israeli week, used when a campaign stores no window: Sun–Thu 09:00–20:00, Friday 09:00–14:00, Saturday closed. */
export const DEFAULT_SEND_WINDOW: SendWindow = {
  days: [0, 1, 2, 3, 4].map((weekday) => dayWindow(weekday, 9, 20)).concat([dayWindow(5, 9, 14)]),
};

const dayWindowSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(MINUTES_PER_DAY - 1),
    endMinute: z.number().int().min(1).max(MINUTES_PER_DAY),
  })
  .refine((d) => d.startMinute < d.endMinute);

export const sendWindowSchema = z
  .object({ days: z.array(dayWindowSchema).max(7) })
  .refine((w) => new Set(w.days.map((d) => d.weekday)).size === w.days.length);

/** Null or an unreadable value keeps the Israeli default. */
export function campaignSendWindow(raw: unknown): SendWindow {
  const parsed = sendWindowSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SEND_WINDOW;
}

export type ChunkTiming = { elapsedMs: number; processMs: number; rows: number };

/** Whole run, the send phase (including pauses), work spent on rows, and how many rows that was. */
export function summarizeRunTiming(runMs: number, chunks: ChunkTiming[]): {
  lastRunMs: number;
  lastSendMs: number;
  lastProcessMs: number;
  lastRowCount: number;
} {
  return {
    lastRunMs: Math.max(0, Math.round(runMs)),
    lastSendMs: chunks.reduce((sum, c) => sum + c.elapsedMs, 0),
    lastProcessMs: chunks.reduce((sum, c) => sum + c.processMs, 0),
    lastRowCount: chunks.reduce((sum, c) => sum + c.rows, 0),
  };
}

/** Average work per recipient, excluding the pause between sends. Null when no row was processed. */
export function averageRowMs(processMs: number, rows: number): number | null {
  if (rows <= 0) return null;
  return Math.round(processMs / rows);
}

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

export function inSendWindow(at: Date, tz: string, window: SendWindow = DEFAULT_SEND_WINDOW): boolean {
  const p = zonedParts(at, tz);
  const day = window.days.find((d) => d.weekday === p.weekday);
  if (!day) return false;
  const minute = p.hour * 60 + p.minute;
  return minute >= day.startMinute && minute < day.endMinute;
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
  /** Tenant cap. Falls back to MAX_SENDS_PER_RUN. */
  maxSendsPerRun?: number;
}): { budget: number; limitedBy: "daily_ceiling" | "batch" | "run" | null } {
  const daily = Math.max(0, opts.dailyCeiling - opts.sentToday);
  const batch = opts.batchSize == null ? Infinity : Math.max(0, opts.batchSize - opts.sentInBatch);
  const cap = opts.maxSendsPerRun ?? MAX_SENDS_PER_RUN;
  const budget = Math.min(daily, batch, cap);
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

const audienceObject = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clients"),
    /**
     * Which synced clients. A source id, or "all" for every source this tenant has connected.
     * Omitted on campaigns saved before sources: every contact, frozen once at confirm.
     */
    sourceId: z.string().min(1).nullable().default(null),
    /** Client for at least this many years (e.g. 4.5). */
    startedYearsAgoMin: z.number().min(0).max(60).nullable().default(null),
    /** Client for at most this many years (e.g. 10). */
    startedYearsAgoMax: z.number().min(0).max(60).nullable().default(null),
    /** Allowed start-date confidence levels; empty = any. */
    confidence: z.array(z.enum(CONFIDENCES)).default([]),
    /** Also include clients with no start date (only when no year range is set). */
    includeNoStartedAt: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("leads"),
    leadIds: z.array(z.string().min(1)).min(1).max(2000),
  }),
]);

/** Saved drafts still use the dealYearsAgo names. */
export const audienceSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  if (o.kind !== "clients") return o;
  if (o.startedYearsAgoMin == null && "dealYearsAgoMin" in o) o.startedYearsAgoMin = o.dealYearsAgoMin;
  if (o.startedYearsAgoMax == null && "dealYearsAgoMax" in o) o.startedYearsAgoMax = o.dealYearsAgoMax;
  if (o.includeNoStartedAt == null && "includeNoDealDate" in o) o.includeNoStartedAt = o.includeNoDealDate;
  return o;
}, audienceObject);
export type Audience = z.infer<typeof audienceObject>;

/** A clients campaign that should pick up contacts synced after confirm. Old audiences have no source. */
export function followsSource(audience: Audience): boolean {
  return audience.kind === "clients" && audience.sourceId != null;
}

export function startedAtRange(a: Extract<Audience, { kind: "clients" }>, now: Date): { gte?: Date; lte?: Date } {
  const yearMs = 365.25 * 24 * 3600 * 1000;
  const range: { gte?: Date; lte?: Date } = {};
  if (a.startedYearsAgoMin != null) range.lte = new Date(now.getTime() - a.startedYearsAgoMin * yearMs);
  if (a.startedYearsAgoMax != null) range.gte = new Date(now.getTime() - a.startedYearsAgoMax * yearMs);
  return range;
}

// ─── Campaign state ─────────────────────────────────────────────────────────

// ─── Follow-ups ─────────────────────────────────────────────────────────────

/** One step after the opener. `send` delivers its template; `escalate` opens one advisor task and stops. */
export const followUpStepSchema = z.object({
  templateId: z.string().min(1).nullable(),
  delayMs: z.number().int().min(60_000).max(30 * 24 * 60 * 60 * 1000),
  onSilence: z.enum(["send", "escalate"]),
});
export type FollowUpStep = z.infer<typeof followUpStepSchema>;

export function parseFollowUps(raw: unknown): FollowUpStep[] {
  const parsed = z.array(followUpStepSchema).max(4).safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.filter((step) => (step.onSilence === "send" ? Boolean(step.templateId) : true));
}

/** Reminder, then one task, for the documents sequence. A campaign with no reminder stays a single send. */
export function documentsFollowUps(reminderTemplateId: string): FollowUpStep[] {
  return [
    { templateId: reminderTemplateId, delayMs: FOLLOW_UP_DELAY_MS, onSilence: "send" },
    { templateId: null, delayMs: FOLLOW_UP_DELAY_MS, onSilence: "escalate" },
  ];
}

export type FollowUpClock = {
  status: string;
  sentAt: Date | null;
  startedAt: Date | null;
  escalatedAt: Date | null;
  reminderClaimedAt: Date | null;
  reminderSentAt: Date | null;
};

/** What this row should do now. Null means wait, or the sequence is finished. */
export function dueFollowUp(row: FollowUpClock, steps: FollowUpStep[], now: Date): "reminder" | "escalate" | "unknown_claim" | null {
  if (row.startedAt || row.escalatedAt || row.status === "unknown") return null;
  const sendStep = steps.find((s) => s.onSilence === "send" && s.templateId);
  const escalateStep = steps.find((s) => s.onSilence === "escalate");
  if (row.reminderClaimedAt && !row.reminderSentAt) {
    return now.getTime() - row.reminderClaimedAt.getTime() >= STUCK_SENDING_MS ? "unknown_claim" : null;
  }
  if (row.status !== "sent" || !row.sentAt) return null;
  if (sendStep && !row.reminderSentAt) {
    return now.getTime() - row.sentAt.getTime() >= sendStep.delayMs ? "reminder" : null;
  }
  const since = row.reminderSentAt ?? (sendStep ? null : row.sentAt);
  if (escalateStep && since && now.getTime() - since.getTime() >= escalateStep.delayMs) return "escalate";
  return null;
}

/** Whole message only. A sentence that mentions one of these words is not a stop. */
const STOP_WORDS = new Set(["הסר", "הסירו", "להסיר", "הסרה", "הפסק", "תפסיקו", "די", "stop", "unsubscribe", "remove"]);

export function isStopReply(text: string): boolean {
  const word = text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return word.length > 0 && STOP_WORDS.has(word);
}

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
