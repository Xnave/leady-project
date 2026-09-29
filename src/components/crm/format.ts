/** Time formatting for the CRM screens. Pure: every function takes `now` for tests. */
type Lang = "he" | "en";

/**
 * The list's clock. `now` starts as the server's request time so the first client render
 * matches the HTML; `local` turns true after mount. Only timezone-free strings (`relTime`)
 * may render while `local` is false; `absTime` / `untilTime` depend on the browser's zone.
 */
export type Clock = { now: Date; local: boolean };

const MIN = 60_000;
const DAY = 1440;

function rtf(lang: Lang) {
  return new Intl.RelativeTimeFormat(lang === "he" ? "he" : "en", { numeric: "auto", style: "short" });
}

/** "5 min. ago", "3 hr. ago", "yesterday", "4 days ago". Future times clamp to now. */
export function relTime(iso: string, lang: Lang, now = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / MIN));
  const f = rtf(lang);
  if (min < 60) return f.format(-min, "minute");
  if (min < DAY) return f.format(-Math.round(min / 60), "hour");
  return f.format(-Math.round(min / DAY), "day");
}

/** A future moment as calendar days from today: "today", "tomorrow", "in 3 days". Past clamps to today. */
export function untilTime(iso: string, lang: Lang, now = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOf(new Date(iso)) - startOf(now)) / (DAY * MIN)));
  return rtf(lang).format(days, "day");
}

export function absTime(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(lang === "he" ? "he-IL" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Next-step presets: 09:00 browser-local time, `days` calendar days after `now`. */
/** Default hour for a next step. */
export const DEFAULT_TIME = "09:00";

function hm(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : [9, 0];
}

/** `days` from today at `time` ("HH:MM", browser zone). */
export function presetAt(days: 1 | 3 | 7, now = new Date(), time = DEFAULT_TIME): string {
  const [h, m] = hm(time);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m, 0, 0).toISOString();
}

/** A `YYYY-MM-DD` date at `time` ("HH:MM", browser zone); null for an invalid date. */
export function dateTimeAt(date: string, time = DEFAULT_TIME): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!d) return null;
  const [h, m] = hm(time);
  return new Date(+d[1], +d[2] - 1, +d[3], h, m, 0, 0).toISOString();
}

/** "HH:MM" of an ISO moment in the browser zone, for `<input type="time">`. */
export function isoToTimeInput(iso: string | null): string {
  if (!iso) return DEFAULT_TIME;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Up to two initials from the letters in a name; phone-number names fall back to "#". */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((w) => w.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean);
  return letters.slice(0, 2).join("").toUpperCase() || "#";
}
