import { DEFAULT_TZ, zonedToday } from "./clock";
import { isAmbiguousBareHour, normalizeSlot } from "./slot";

export type VenueHoursWindow = {
  openMinutes: number;
  closeMinutes: number;
};

/** One open–close window, optionally scoped to weekdays (0=Sun … 6=Sat). */
export type VenueHoursSegment = VenueHoursWindow & {
  /** null = applies every day / no day label on this clause. */
  days: number[] | null;
};

/**
 * Persisted bookable windows on the booking capability instance.
 * `days` uses JS getDay() (0=Sun … 6=Sat). `open`/`close` are 24h `HH:MM`.
 */
export type VenueScheduleSegment = {
  days: number[];
  open: string;
  close: string;
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Last bookable start must be at least this many minutes before closing. */
export const LAST_BOOKABLE_BEFORE_CLOSE_MINUTES = 30;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToClock(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function clockToMinutes(clock: string): number | null {
  const m = clock.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return toMinutes(h, min);
}

const HE_DAY_LETTER: Record<string, number> = {
  א: 0,
  ב: 1,
  ג: 2,
  ד: 3,
  ה: 4,
  ו: 5,
  ש: 6,
};

/** Longer names first so "שלישי" is not eaten by "שני". */
const HE_DAY_NAMES: { re: RegExp; day: number }[] = [
  { re: /יום\s*ראשון|ראשון/g, day: 0 },
  { re: /יום\s*שלישי|שלישי/g, day: 2 },
  { re: /יום\s*רביעי|רביעי/g, day: 3 },
  { re: /יום\s*חמישי|חמישי/g, day: 4 },
  { re: /יום\s*שישי|שישי/g, day: 5 },
  { re: /שבת/g, day: 6 },
  { re: /יום\s*שני|(?<![א-ת])שני(?![א-ת])/g, day: 1 },
];

const EN_DAY_NAMES: { re: RegExp; day: number }[] = [
  { re: /\bsundays?\b/gi, day: 0 },
  { re: /\bmondays?\b/gi, day: 1 },
  { re: /\btuesdays?\b/gi, day: 2 },
  { re: /\bwednesdays?\b/gi, day: 3 },
  { re: /\bthursdays?\b/gi, day: 4 },
  { re: /\bfridays?\b/gi, day: 5 },
  { re: /\bsaturdays?\b/gi, day: 6 },
  { re: /\bsun\b/gi, day: 0 },
  { re: /\bmon\b/gi, day: 1 },
  { re: /\btue\b/gi, day: 2 },
  { re: /\bwed\b/gi, day: 3 },
  { re: /\bthu\b/gi, day: 4 },
  { re: /\bfri\b/gi, day: 5 },
  { re: /\bsat\b/gi, day: 6 },
];

const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?/g;

function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

function clockFromMatch(m: RegExpMatchArray): VenueHoursWindow | null {
  const openH = Number(m[1]);
  const openM = m[2] ? Number(m[2]) : 0;
  const closeH = Number(m[3]);
  const closeM = m[4] ? Number(m[4]) : 0;
  if (
    openH < 0 ||
    openH > 23 ||
    closeH < 0 ||
    closeH > 23 ||
    openM < 0 ||
    openM > 59 ||
    closeM < 0 ||
    closeM > 59
  ) {
    return null;
  }
  const openMinutes = toMinutes(openH, openM);
  const closeMinutes = toMinutes(closeH, closeM);
  if (closeMinutes <= openMinutes) return null;
  return { openMinutes, closeMinutes };
}

function expandDayRange(start: number, end: number): number[] {
  const out: number[] = [];
  let d = start;
  for (let i = 0; i < 7; i++) {
    out.push(d);
    if (d === end) break;
    d = (d + 1) % 7;
  }
  return out;
}

function uniqueSorted(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/** True when the clause text is only separators (no day labels). */
function isBlankDayPrefix(text: string): boolean {
  return !text.trim() || /^[\s,;|/·•\-–—]+$/.test(text.trim());
}

/**
 * Weekday set from the clause text that precedes a time range.
 * Supports ranges (א-ה / Sun–Thu), lists (א', ג', ה' / Mon, Wed),
 * and Hebrew full names (שישי, שבת).
 */
export function parseDaysFromHoursPrefix(prefix: string): number[] | null {
  const text = prefix.trim();
  if (isBlankDayPrefix(text)) return null;

  const found: number[] = [];

  const heRange = text.match(
    /([אבגדהוש])(?:['׳])?\s*[-–—]\s*([אבגדהוש])(?:['׳])?/,
  );
  if (heRange) {
    const a = HE_DAY_LETTER[heRange[1]];
    const b = HE_DAY_LETTER[heRange[2]];
    if (a !== undefined && b !== undefined) found.push(...expandDayRange(a, b));
  }

  const enRange = text.match(
    /\b(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\s*[-–—]\s*(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i,
  );
  if (enRange) {
    const a = EN_DAY_NAMES.find((x) => new RegExp(x.re.source, "i").test(enRange[1]))?.day;
    const b = EN_DAY_NAMES.find((x) => new RegExp(x.re.source, "i").test(enRange[2]))?.day;
    if (a !== undefined && b !== undefined) found.push(...expandDayRange(a, b));
  }

  // Full Hebrew weekday names (before single letters, so "שישי" ≠ letter list).
  let stripped = text;
  for (const { re, day } of HE_DAY_NAMES) {
    const copy = new RegExp(re.source, re.flags);
    if (copy.test(stripped)) {
      found.push(day);
      stripped = stripped.replace(new RegExp(re.source, re.flags), " ");
    }
  }

  // Hebrew day-letter lists: א', ג', ה' or א,ג,ה
  for (const m of stripped.matchAll(/([אבגדהוש])(?:['׳])?/g)) {
    const d = HE_DAY_LETTER[m[1]];
    if (d !== undefined) found.push(d);
  }

  // English weekday tokens (lists or singles).
  for (const { re, day } of EN_DAY_NAMES) {
    if (new RegExp(re.source, re.flags).test(text)) found.push(day);
  }

  if (found.length === 0) return null;
  return uniqueSorted(found);
}

/**
 * Split free-text hours into day-scoped windows
 * (e.g. "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00").
 */
export function parseVenueHoursSegments(hours: string): VenueHoursSegment[] {
  const text = hours.trim();
  if (!text) return [];
  const segments: VenueHoursSegment[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(TIME_RANGE_RE)) {
    const window = clockFromMatch(m);
    if (!window) continue;
    const prefix = text.slice(lastEnd, m.index ?? lastEnd);
    lastEnd = (m.index ?? 0) + m[0].length;
    const days = parseDaysFromHoursPrefix(prefix);
    // Prefix has words but no parseable days → skip rather than treat as "every day"
    // (that used to make a trailing "שישי 09:00-13:00" override weekdays).
    if (days === null && !isBlankDayPrefix(prefix)) continue;
    segments.push({ ...window, days });
  }
  return segments;
}

/**
 * Pick the open–close window for a weekday (0=Sun … 6=Sat).
 * Without a weekday, prefers the clause covering the most days (or the first).
 */
export function parseVenueHoursWindow(
  hours: string,
  weekday?: number | null,
): VenueHoursWindow | null {
  return windowFromSchedule(normalizeVenueSchedule(hours), weekday);
}

/** Normalize free-text hours into the persisted schedule shape. */
export function normalizeVenueSchedule(hours: string): VenueScheduleSegment[] {
  return parseVenueHoursSegments(hours).map((s) => ({
    days: s.days?.length ? [...s.days] : [...ALL_DAYS],
    open: minutesToClock(s.openMinutes),
    close: minutesToClock(s.closeMinutes),
  }));
}

/** Validate / coerce stored JSON into schedule segments. */
export function parseVenueSchedule(raw: unknown): VenueScheduleSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: VenueScheduleSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const open = typeof o.open === "string" ? o.open.trim() : "";
    const close = typeof o.close === "string" ? o.close.trim() : "";
    if (clockToMinutes(open) === null || clockToMinutes(close) === null) continue;
    const openMins = clockToMinutes(open)!;
    const closeMins = clockToMinutes(close)!;
    if (closeMins <= openMins) continue;
    const daysRaw = Array.isArray(o.days) ? o.days : [];
    const days = [
      ...new Set(
        daysRaw
          .map((d) => (typeof d === "number" ? d : Number(d)))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      ),
    ].sort((a, b) => a - b);
    if (days.length === 0) continue;
    out.push({ days, open: minutesToClock(openMins), close: minutesToClock(closeMins) });
  }
  return out;
}

/** Resolve a clock window from a persisted schedule. */
export function windowFromSchedule(
  schedule: VenueScheduleSegment[],
  weekday?: number | null,
): VenueHoursWindow | null {
  if (schedule.length === 0) return null;

  const asWindow = (s: VenueScheduleSegment): VenueHoursWindow | null => {
    const openMinutes = clockToMinutes(s.open);
    const closeMinutes = clockToMinutes(s.close);
    if (openMinutes === null || closeMinutes === null) return null;
    if (closeMinutes <= openMinutes) return null;
    return { openMinutes, closeMinutes };
  };

  if (weekday !== null && weekday !== undefined) {
    const specific = schedule.find((s) => s.days.includes(weekday));
    if (specific) return asWindow(specific);
    return null;
  }

  const ranked = [...schedule].sort((a, b) => b.days.length - a.days.length);
  return asWindow(ranked[0]!);
}

/** Latest clock time (minutes from midnight) that may start a visit. */
export function lastBookableMinutes(window: VenueHoursWindow): number {
  return window.closeMinutes - LAST_BOOKABLE_BEFORE_CLOSE_MINUTES;
}

function weekdayFromIso(dateIso: string): number | null {
  const m = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.getDay();
}

/**
 * Whether a customer time preference falls inside bookable venue hours.
 * Closing hour itself is not bookable — must start at least
 * {@link LAST_BOOKABLE_BEFORE_CLOSE_MINUTES} before close.
 * Prefer a persisted {@link VenueScheduleSegment} list when available;
 * otherwise parse free-text `hours` as a fallback.
 *
 * Prefer {@link checkBookableSlot} for new call sites — it distinguishes
 * ambiguous / unclear / invalid-hours instead of collapsing them to `null`.
 * `null` = cannot decide (legacy wrapper).
 */
export function isSlotWithinVenueHours(
  slotText: string,
  hours: string,
  opts?: {
    now?: Date;
    lang?: "en" | "he";
    schedule?: VenueScheduleSegment[];
    timeZone?: string;
  },
): boolean | null {
  const result = checkBookableSlot({
    slotText,
    hoursLabel: hours,
    schedule: opts?.schedule,
    now: opts?.now,
    lang: opts?.lang,
    timeZone: opts?.timeZone,
  });
  if (result.status === "ok") return true;
  if (result.status === "outside_hours") return false;
  return null;
}

export type BookableSlotStatus =
  | "ok"
  | "outside_hours"
  | "ambiguous_time"
  | "unclear_time"
  | "invalid_hours";

export type BookableSlotResult = { status: BookableSlotStatus };

/**
 * Deterministic booking hours gate. Fail-closed when hours are configured but
 * unusable, or when the customer time is ambiguous / missing a clock.
 * When no hours are configured at all, returns `ok` (gate off).
 */
export function checkBookableSlot(opts: {
  slotText: string;
  hoursLabel: string;
  schedule?: VenueScheduleSegment[];
  now?: Date;
  lang?: "en" | "he";
  timeZone?: string;
}): BookableSlotResult {
  const hoursLabel = opts.hoursLabel.trim();
  const hoursConfigured = Boolean(hoursLabel) || Boolean(opts.schedule?.length);
  if (!hoursConfigured) return { status: "ok" };

  const schedule =
    opts.schedule && opts.schedule.length > 0
      ? opts.schedule
      : normalizeVenueSchedule(hoursLabel);
  if (schedule.length === 0) return { status: "invalid_hours" };

  const slotText = opts.slotText.trim();
  if (isAmbiguousBareHour(slotText)) return { status: "ambiguous_time" };

  const timeZone = opts.timeZone?.trim() || DEFAULT_TZ;
  const now = opts.now ?? new Date();
  const slot = normalizeSlot(slotText, {
    now: zonedToday(now, timeZone),
    lang: opts.lang ?? "he",
  });
  if (!slot.time) return { status: "unclear_time" };

  const weekday = slot.dateIso ? weekdayFromIso(slot.dateIso) : null;
  const window = windowFromSchedule(schedule, weekday);
  if (!window) {
    return { status: weekday !== null ? "outside_hours" : "unclear_time" };
  }

  const [h, m] = slot.time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { status: "unclear_time" };
  const mins = toMinutes(h, m);
  const latest = lastBookableMinutes(window);
  if (latest < window.openMinutes) return { status: "invalid_hours" };
  if (mins >= window.openMinutes && mins <= latest) return { status: "ok" };
  return { status: "outside_hours" };
}
