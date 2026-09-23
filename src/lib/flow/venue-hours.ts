import { normalizeSlot } from "./slot";

export type VenueHoursWindow = {
  openMinutes: number;
  closeMinutes: number;
};

/** One open–close window, optionally scoped to weekdays (0=Sun … 6=Sat). */
export type VenueHoursSegment = VenueHoursWindow & {
  /** null = applies every day / no day label on this clause. */
  days: number[] | null;
};

/** Last bookable start must be at least this many minutes before closing. */
export const LAST_BOOKABLE_BEFORE_CLOSE_MINUTES = 30;

const HE_DAY_LETTER: Record<string, number> = {
  א: 0,
  ב: 1,
  ג: 2,
  ד: 3,
  ה: 4,
  ו: 5,
  ש: 6,
};

const EN_DAY_NAMES: { re: RegExp; day: number }[] = [
  { re: /\bsunday\b/i, day: 0 },
  { re: /\bmonday\b/i, day: 1 },
  { re: /\btuesday\b/i, day: 2 },
  { re: /\bwednesday\b/i, day: 3 },
  { re: /\bthursday\b/i, day: 4 },
  { re: /\bfriday\b/i, day: 5 },
  { re: /\bsaturday\b/i, day: 6 },
  { re: /\bsun\b/i, day: 0 },
  { re: /\bmon\b/i, day: 1 },
  { re: /\btue\b/i, day: 2 },
  { re: /\bwed\b/i, day: 3 },
  { re: /\bthu\b/i, day: 4 },
  { re: /\bfri\b/i, day: 5 },
  { re: /\bsat\b/i, day: 6 },
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

/** Weekday set from the clause text that precedes a time range. */
export function parseDaysFromHoursPrefix(prefix: string): number[] | null {
  const text = prefix.trim();
  if (!text) return null;

  const heRange = text.match(
    /([אבגדהוש])(?:['׳])?\s*[-–—]\s*([אבגדהוש])(?:['׳])?/,
  );
  if (heRange) {
    const a = HE_DAY_LETTER[heRange[1]];
    const b = HE_DAY_LETTER[heRange[2]];
    if (a !== undefined && b !== undefined) return expandDayRange(a, b);
  }

  if (/שבת/.test(text)) return [6];

  const heSingle = text.match(/(?:^|[\s,;(/])(?:יום\s*)?([אבגדהוש])(?:['׳])?\s*$/);
  if (heSingle) {
    const d = HE_DAY_LETTER[heSingle[1]];
    if (d !== undefined) return [d];
  }

  const enRange = text.match(
    /\b(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\s*[-–—]\s*(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i,
  );
  if (enRange) {
    const a = EN_DAY_NAMES.find((x) => x.re.test(enRange[1]))?.day;
    const b = EN_DAY_NAMES.find((x) => x.re.test(enRange[2]))?.day;
    if (a !== undefined && b !== undefined) return expandDayRange(a, b);
  }

  for (const { re, day } of EN_DAY_NAMES) {
    if (re.test(text)) return [day];
  }

  return null;
}

/**
 * Split free-text hours into day-scoped windows
 * (e.g. "ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00").
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
    segments.push({ ...window, days: parseDaysFromHoursPrefix(prefix) });
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
  const segments = parseVenueHoursSegments(hours);
  if (segments.length === 0) return null;

  if (weekday !== null && weekday !== undefined) {
    const specific = segments.find((s) => s.days?.includes(weekday));
    if (specific) {
      return { openMinutes: specific.openMinutes, closeMinutes: specific.closeMinutes };
    }
    const unscoped = segments.find((s) => s.days === null);
    if (unscoped) {
      return { openMinutes: unscoped.openMinutes, closeMinutes: unscoped.closeMinutes };
    }
    // Day is known and listed hours do not cover it → closed that day.
    return null;
  }

  // No weekday: prefer the broadest day span, then first clause (not the last —
  // dual-range strings often end with a short Friday window).
  const ranked = [...segments].sort(
    (a, b) => (b.days?.length ?? 7) - (a.days?.length ?? 7),
  );
  const best = ranked[0]!;
  return { openMinutes: best.openMinutes, closeMinutes: best.closeMinutes };
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
 * `null` = cannot decide (missing clock time and/or unparseable hours).
 */
export function isSlotWithinVenueHours(
  slotText: string,
  hours: string,
  opts?: { now?: Date; lang?: "en" | "he" },
): boolean | null {
  const segments = parseVenueHoursSegments(hours);
  if (segments.length === 0) return null;

  const slot = normalizeSlot(slotText.trim(), {
    now: opts?.now,
    lang: opts?.lang ?? "he",
  });
  if (!slot.time) return null;

  const weekday = slot.dateIso ? weekdayFromIso(slot.dateIso) : null;
  const window = parseVenueHoursWindow(hours, weekday);
  // Known day with no covering clause → outside hours (closed).
  if (!window) {
    return weekday !== null ? false : null;
  }

  const [h, m] = slot.time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const mins = toMinutes(h, m);
  const latest = lastBookableMinutes(window);
  if (latest < window.openMinutes) return null;
  return mins >= window.openMinutes && mins <= latest;
}
