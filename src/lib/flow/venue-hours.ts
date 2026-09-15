import { normalizeSlot } from "./slot";

export type VenueHoursWindow = {
  openMinutes: number;
  closeMinutes: number;
};

/** Last bookable start must be at least this many minutes before closing. */
export const LAST_BOOKABLE_BEFORE_CLOSE_MINUTES = 30;

function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/**
 * Extract an open–close window from free-text hours (e.g. "א-ה 9-19", "Sun–Thu 09:00–19:00").
 * Uses the last time range in the string. Returns null when nothing parseable.
 */
export function parseVenueHoursWindow(hours: string): VenueHoursWindow | null {
  const text = hours.trim();
  if (!text) return null;
  const matches = [
    ...text.matchAll(/(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?/g),
  ];
  const m = matches[matches.length - 1];
  if (!m) return null;
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

/** Latest clock time (minutes from midnight) that may start a visit. */
export function lastBookableMinutes(window: VenueHoursWindow): number {
  return window.closeMinutes - LAST_BOOKABLE_BEFORE_CLOSE_MINUTES;
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
  const window = parseVenueHoursWindow(hours);
  if (!window) return null;
  const slot = normalizeSlot(slotText.trim(), {
    now: opts?.now,
    lang: opts?.lang ?? "he",
  });
  if (!slot.time) return null;
  const [h, m] = slot.time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const mins = toMinutes(h, m);
  const latest = lastBookableMinutes(window);
  if (latest < window.openMinutes) return null;
  return mins >= window.openMinutes && mins <= latest;
}
