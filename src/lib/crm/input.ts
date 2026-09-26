import { isPipelineStage, type PipelineStage } from "./types";

type Err = { error: string };
const obj = (b: unknown): Record<string, unknown> =>
  b && typeof b === "object" ? (b as Record<string, unknown>) : {};

export function parseStageBody(b: unknown): { stage: PipelineStage; reason: string } | Err {
  const o = obj(b);
  if (!isPipelineStage(o.stage)) return { error: "bad_stage" };
  const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "";
  return { stage: o.stage, reason };
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseNextStepBody(
  b: unknown,
  _now: Date,
): { text: string | null; at: Date | null } | Err {
  const o = obj(b);
  if (o.done === true) return { text: null, at: null };
  const at = parseDate(o.at);
  if (!at) return { error: "bad_date" };
  const text = typeof o.text === "string" && o.text.trim() ? o.text.trim().slice(0, 300) : null;
  return { text, at };
}

/** 09:00 local time `days` days after `now`, in the given IANA timezone. */
export function snoozePresetUntil(days: 1 | 3 | 7, now: Date, tz: string): Date {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + days * 86_400_000));
  // Find the UTC instant whose local wall time is `${local}T09:00`.
  const guess = new Date(`${local}T09:00:00Z`);
  const offsetMin = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function parseSnoozeBody(
  b: unknown,
  now: Date,
  tz = "Asia/Jerusalem",
): { until: Date } | Err {
  const o = obj(b);
  if (o.days !== undefined) {
    if (o.days !== 1 && o.days !== 3 && o.days !== 7) return { error: "bad_days" };
    return { until: snoozePresetUntil(o.days, now, tz) };
  }
  const until = parseDate(o.until);
  if (!until || until.getTime() <= now.getTime()) return { error: "bad_date" };
  return { until };
}

export function parseNoteBody(b: unknown): { body: string; pinned: boolean } | Err {
  const o = obj(b);
  const body = typeof o.body === "string" ? o.body.trim() : "";
  if (!body) return { error: "empty" };
  if (body.length > 5000) return { error: "too_long" };
  return { body, pinned: o.pinned === true };
}
