/** Time formatting for the CRM screens. Pure: every function takes `now` for tests. */
type Lang = "he" | "en";

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
export function presetAt(days: 1 | 3 | 7, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 9, 0, 0, 0);
  return d.toISOString();
}

/** Up to two initials from the letters in a name; phone-number names fall back to "#". */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((w) => w.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean);
  return letters.slice(0, 2).join("").toUpperCase() || "#";
}
