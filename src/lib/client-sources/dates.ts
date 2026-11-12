import type { DealDate, DealDateConfidence } from "./types";

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/;

/** CRM dates arrive as DD/MM/YYYY[ HH:MM] or ISO. Zero dates ("0000-00-00", "00/00/0000") are empty. */
export function parseClientDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.startsWith("0000") || v.startsWith("00/00") || v.startsWith("00.00")) return null;
  let d: number, mo: number, y: number;
  const dmy = v.match(DMY);
  const ymd = dmy ? null : v.match(YMD);
  if (dmy) [d, mo, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (ymd) [y, mo, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
  else return null;
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  // 31/02 rolls into March: reject instead of guessing.
  if (date.getUTCMonth() !== mo - 1) return null;
  return date;
}

export function addMonths(date: Date, months: number): Date {
  const out = new Date(date);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

/** One rung of the deal-date ladder: the first rung with a usable date wins. */
export type DealDateStep = {
  field: string;
  offsetMonths: number;
  confidence: DealDateConfidence;
  /** Only use this rung when `fields[whenField]` is one of `whenIn`. An empty list never matches. */
  whenField?: string;
  whenIn?: string[];
};

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function deriveDealDate(fields: Record<string, unknown>, steps: DealDateStep[]): DealDate {
  for (const step of steps) {
    if (step.whenField) {
      const allowed = step.whenIn ?? [];
      if (!allowed.includes(asText(fields[step.whenField]))) continue;
    }
    const raw = parseClientDate(fields[step.field]);
    if (!raw) continue;
    return { date: addMonths(raw, step.offsetMonths), source: step.field, confidence: step.confidence };
  }
  return { date: null, source: "", confidence: "" };
}

/** Whole years between two dates, as a fraction (4.5 = four and a half years). */
export function yearsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000);
}
