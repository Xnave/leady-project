/** Resolve customer time wording into a concrete calendar date + clock time. */

const HE_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const EN_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type NormalizedSlot = {
  /** Original customer wording */
  raw: string;
  /** Calendar date YYYY-MM-DD when known */
  dateIso?: string;
  /** 24h HH:MM when known */
  time?: string;
  /** Human date line for messages */
  dateLabel: string;
  /** Human time line for messages */
  timeLabel: string;
  /** Combined display used as meeting.slotText */
  display: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseTime(text: string): string | undefined {
  const ampm = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2] ? Number(ampm[2]) : 0;
    const ap = ampm[3].toLowerCase().startsWith("p");
    if (ap && h < 12) h += 12;
    if (!ap && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad2(h)}:${pad2(m)}`;
  }
  const twentyFour = text.match(/(?:^|[^\d])(\d{1,2})[:.](\d{2})(?:[^\d]|$)/);
  if (twentyFour) {
    const h = Number(twentyFour[1]);
    const m = Number(twentyFour[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad2(h)}:${pad2(m)}`;
  }
  const bare = text.match(
    /(?:ב־|ב-|at\s+|בשעה\s+|ב\s*)(\d{1,2})(?:\s*(?:בבוקר|בערב|בצהריים))?/i,
  );
  if (bare) {
    let h = Number(bare[1]);
    if (/ערב|pm/i.test(text) && h < 12) h += 12;
    if (/בוקר|am/i.test(text) && h === 12) h = 0;
    if (h >= 0 && h <= 23) return `${pad2(h)}:00`;
  }
  return undefined;
}

function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const delta = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function resolveDay(text: string, now: Date): Date | undefined {
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/היום|\btoday\b/i.test(text)) return today;
  if (/מחר|\btomorrow\b/i.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (/מחרתיים|\bday after tomorrow\b/i.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return d;
  }

  const heNames = [...HE_WEEKDAYS].map((name, weekday) => ({ name, weekday }));
  heNames.sort((a, b) => b.name.length - a.name.length);
  for (const { name, weekday } of heNames) {
    if (t.includes(`יום ${name}`) || new RegExp(`(?:^|[^א-ת])${name}(?:$|[^א-ת])`).test(t)) {
      return nextWeekday(today, weekday);
    }
  }

  const enNames = [...EN_WEEKDAYS].map((name, weekday) => ({
    name: name.toLowerCase(),
    weekday,
  }));
  enNames.sort((a, b) => b.name.length - a.name.length);
  for (const { name, weekday } of enNames) {
    if (t.includes(name)) return nextWeekday(today, weekday);
  }

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const slash = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    const year = slash[3] ? Number(slash[3]) : today.getFullYear();
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) {
      if (!slash[3] && d.getTime() < today.getTime()) d.setFullYear(year + 1);
      return d;
    }
  }

  return undefined;
}

function formatDateLabel(d: Date, lang: "en" | "he"): string {
  if (lang === "he") {
    return `${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  return `${EN_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function normalizeSlot(
  raw: string,
  opts?: { now?: Date; lang?: "en" | "he" },
): NormalizedSlot {
  const text = raw.trim();
  const now = opts?.now ?? new Date();
  const lang = opts?.lang ?? "he";
  const day = resolveDay(text, now);
  const time = parseTime(text);

  if (!day && !time) {
    return {
      raw: text,
      dateLabel: text,
      timeLabel: "",
      display: text,
    };
  }

  const dateIso = day ? toDateIso(day) : undefined;
  const dateLabel = day ? formatDateLabel(day, lang) : text;
  const timeLabel = time ?? "";
  const display =
    day && time
      ? lang === "he"
        ? `${dateLabel} בשעה ${timeLabel}`
        : `${dateLabel} at ${timeLabel}`
      : day
        ? dateLabel
        : time
          ? lang === "he"
            ? `בשעה ${timeLabel}`
            : `at ${timeLabel}`
          : text;

  return { raw: text, dateIso, time, dateLabel, timeLabel, display };
}
