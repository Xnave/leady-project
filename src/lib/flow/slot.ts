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
  /** Human date line for messages (never includes the clock) */
  dateLabel: string;
  /** Human time line for messages (HH:MM only when known) */
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

function expandYear(raw: string, todayYear: number): number {
  if (raw.length === 4) return Number(raw);
  const two = Number(raw);
  // 00–79 → 2000+, 80–99 → 1900+
  return two >= 80 ? 1900 + two : 2000 + two;
}

/** Remove date fragments so time parsing does not treat 11.11.26 as 11:11. */
function stripDateFragments(text: string): string {
  let out = text;
  out = out.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, " ");
  out = out.replace(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/g, " ");
  for (const name of [...HE_MONTHS].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\d{1,2}\\s*ב\\s*${name}(?:\\s+\\d{4})?`, "gi"), " ");
  }
  for (const name of [...EN_MONTHS].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${name}\\s+\\d{1,2}(?:,)?\\s*\\d{0,4}\\b`, "gi"), " ");
  }
  return out;
}

function parseTime(text: string): string | undefined {
  const forTime = stripDateFragments(text);
  const ampm = forTime.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = ampm[2] ? Number(ampm[2]) : 0;
    const ap = ampm[3].toLowerCase().startsWith("p");
    if (ap && h < 12) h += 12;
    if (!ap && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad2(h)}:${pad2(m)}`;
  }
  // Colon only — never treat dotted dates (11.11) as a clock time.
  const colon = forTime.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad2(h)}:${pad2(m)}`;
  }
  const bare = forTime.match(
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

function resolveMonthNameDate(text: string, now: Date, lang: "en" | "he"): Date | undefined {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (lang === "he" || /ב[א-ת]+/.test(text)) {
    const months = HE_MONTHS.map((name, month) => ({ name, month })).sort(
      (a, b) => b.name.length - a.name.length,
    );
    for (const { name, month } of months) {
      const m = text.match(
        new RegExp(`(\\d{1,2})\\s*ב\\s*${name}(?:\\s+(\\d{4}))?`, "i"),
      );
      if (!m) continue;
      const day = Number(m[1]);
      const year = m[2] ? Number(m[2]) : today.getFullYear();
      const d = new Date(year, month, day);
      if (Number.isNaN(d.getTime())) continue;
      if (!m[2] && d.getTime() < today.getTime()) d.setFullYear(year + 1);
      return d;
    }
  }
  const months = EN_MONTHS.map((name, month) => ({ name, month })).sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const { name, month } of months) {
    const m = text.match(
      new RegExp(`\\b${name}\\s+(\\d{1,2})(?:,)?\\s*(\\d{4})?\\b`, "i"),
    );
    if (!m) continue;
    const day = Number(m[1]);
    const year = m[2] ? Number(m[2]) : today.getFullYear();
    const d = new Date(year, month, day);
    if (Number.isNaN(d.getTime())) continue;
    if (!m[2] && d.getTime() < today.getTime()) d.setFullYear(year + 1);
    return d;
  }
  return undefined;
}

function resolveDay(text: string, now: Date, lang: "en" | "he" = "he"): Date | undefined {
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

  const named = resolveMonthNameDate(text, now, lang);
  if (named) return named;

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

  // 11.11.26 / 11/11/2026 / 11.11
  const slash = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    const year = slash[3] ? expandYear(slash[3], today.getFullYear()) : today.getFullYear();
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime()) && d.getMonth() === month && d.getDate() === day) {
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

/** Split an already-normalized display string back into date + time. */
function splitExistingDisplay(
  text: string,
  lang: "en" | "he",
): { dateLabel: string; timeLabel: string } | null {
  if (lang === "he") {
    const m = text.match(/^(.+?)\s+בשעה\s+(\d{1,2}:\d{2})\s*$/);
    if (m) return { dateLabel: m[1].trim(), timeLabel: m[2] };
  } else {
    const m = text.match(/^(.+?)\s+at\s+(\d{1,2}:\d{2})\s*$/i);
    if (m) return { dateLabel: m[1].trim(), timeLabel: m[2] };
  }
  return null;
}

export function normalizeSlot(
  raw: string,
  opts?: { now?: Date; lang?: "en" | "he" },
): NormalizedSlot {
  const text = raw.trim();
  const now = opts?.now ?? new Date();
  const lang = opts?.lang ?? "he";

  const existing = splitExistingDisplay(text, lang);
  if (existing) {
    const day = resolveDay(existing.dateLabel, now, lang);
    const display =
      existing.dateLabel && existing.timeLabel
        ? lang === "he"
          ? `${existing.dateLabel} בשעה ${existing.timeLabel}`
          : `${existing.dateLabel} at ${existing.timeLabel}`
        : text;
    return {
      raw: text,
      dateIso: day ? toDateIso(day) : undefined,
      time: existing.timeLabel,
      dateLabel: existing.dateLabel,
      timeLabel: existing.timeLabel,
      display,
    };
  }

  const day = resolveDay(text, now, lang);
  const time = parseTime(text);

  if (!day && !time) {
    return {
      raw: text,
      dateLabel: text,
      timeLabel: "",
      display: text,
    };
  }

  // Time-only: never put "בשעה HH:MM" into dateLabel (templates say בתאריך {{date}} בשעה {{time}}).
  if (!day && time) {
    const display = lang === "he" ? `בשעה ${time}` : `at ${time}`;
    return {
      raw: text,
      time,
      dateLabel: "",
      timeLabel: time,
      display,
    };
  }

  const dateIso = day ? toDateIso(day) : undefined;
  const dateLabel = day ? formatDateLabel(day, lang) : "";
  const timeLabel = time ?? "";
  const display =
    day && time
      ? lang === "he"
        ? `${dateLabel} בשעה ${timeLabel}`
        : `${dateLabel} at ${timeLabel}`
      : dateLabel || text;

  return { raw: text, dateIso, time, dateLabel, timeLabel, display };
}

/**
 * True when the customer named a day and/or clock time that conflicts with a
 * staff-offered slot. Used to block false "accept" on a fresh booking ask
 * (e.g. "Sunday at 11" while the offer is Nov 11 at 10:00).
 */
export function proposesDifferentSlot(
  customerText: string,
  offeredSlot: string,
  opts?: { now?: Date; lang?: "en" | "he" },
): boolean {
  const lang = opts?.lang ?? "he";
  const now = opts?.now ?? new Date();
  const proposed = normalizeSlot(customerText.trim(), { lang, now });
  const offered = normalizeSlot(offeredSlot.trim(), { lang, now });
  if (!proposed.dateIso && !proposed.time) return false;
  if (proposed.dateIso && offered.dateIso && proposed.dateIso !== offered.dateIso) {
    return true;
  }
  if (proposed.time && offered.time && proposed.time !== offered.time) {
    return true;
  }
  // They named a day/time but the offer could not be parsed the same way —
  // treat as a different proposal rather than silently approving.
  if ((proposed.dateIso || proposed.time) && !offered.dateIso && !offered.time) {
    return true;
  }
  return false;
}
