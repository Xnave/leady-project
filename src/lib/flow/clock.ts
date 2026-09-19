/** Civil calendar for talk prompts and date parsing. Default is Israel. */

export const DEFAULT_TZ = "Asia/Jerusalem";

function ymdInZone(now: Date, timeZone: string): { year: string; month: string; day: string } {
  const map: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return { year: map.year, month: map.month, day: map.day };
}

/** YYYY-MM-DD of `now` in `timeZone`. */
export function todayIsoDate(now: Date = new Date(), timeZone: string = DEFAULT_TZ): string {
  const { year, month, day } = ymdInZone(now, timeZone);
  return `${year}-${month}-${day}`;
}

/**
 * Midnight Date whose Y-M-D (in the process local zone) matches today's civil
 * date in `timeZone`. Weekday math and `toIsoDate` then follow that calendar day.
 */
export function zonedToday(now: Date = new Date(), timeZone: string = DEFAULT_TZ): Date {
  const iso = todayIsoDate(now, timeZone);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** System-prompt line so the model does not invent a training-cutoff "today". */
export function calendarClockLine(now: Date = new Date(), timeZone: string = DEFAULT_TZ): string {
  const map: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(now)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return `Today is ${map.weekday}, ${map.day} ${map.month} ${map.year} (${timeZone}). Use this for "today", weekdays, and relative dates. Do not invent another calendar.`;
}
