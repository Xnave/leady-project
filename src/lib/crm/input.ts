import { z } from "zod";
import { PIPELINE_STAGES, type PipelineStage } from "./types";

/**
 * Request bodies for the CRM routes. Each schema reports a short error code as the
 * issue message; `parse` returns the parsed value or `{ error: code }` for a 400.
 */
type Err = { error: string };

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown, fallback: string): T | Err {
  const r = schema.safeParse(body ?? {});
  return r.success ? r.data : { error: r.error.issues[0]?.message ?? fallback };
}

const isoDate = (code: string) =>
  z
    .string({ message: code })
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()), { message: code });

const trimmed = (max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim().slice(0, max));

const stageBody = z.object(
  { stage: z.enum(PIPELINE_STAGES, { message: "bad_stage" }), reason: trimmed(200) },
  { message: "bad_stage" },
);

export function parseStageBody(b: unknown): { stage: PipelineStage; reason: string } | Err {
  return parse(stageBody, b, "bad_stage");
}

const nextStepBody = z.union([
  z.object({ done: z.literal(true) }).transform(() => ({ text: null, at: null })),
  z
    .object({ at: isoDate("bad_date"), text: trimmed(300) })
    .transform(({ at, text }) => ({ text: text || null, at })),
]);

export function parseNextStepBody(b: unknown, _now: Date): { text: string | null; at: Date | null } | Err {
  const r = nextStepBody.safeParse(b ?? {});
  // A union reports every branch; the date is the only thing a caller can get wrong.
  return r.success ? r.data : { error: "bad_date" };
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

const snoozeDays = z.union([z.literal(1), z.literal(3), z.literal(7)], { errorMap: () => ({ message: "bad_days" }) });

/** A preset (`days`: tomorrow / 3 days / a week, 09:00 local) or an explicit future `until`. */
export function parseSnoozeBody(
  b: unknown,
  now: Date,
  tz = "Asia/Jerusalem",
): { until: Date } | Err {
  if ((b as { days?: unknown } | null)?.days !== undefined) {
    const preset = z.object({ days: snoozeDays }).transform(({ days }) => ({ until: snoozePresetUntil(days, now, tz) }));
    return parse(preset, b, "bad_days");
  }
  const until = isoDate("bad_date").refine((d) => d.getTime() > now.getTime(), { message: "bad_date" });
  return parse(z.object({ until }, { message: "bad_date" }), b, "bad_date");
}

const noteBody = z.object({
  body: z
    .string({ message: "empty" })
    .trim()
    .min(1, { message: "empty" })
    .max(5000, { message: "too_long" }),
  pinned: z.boolean().optional().default(false),
});

export function parseNoteBody(b: unknown): { body: string; pinned: boolean } | Err {
  return parse(noteBody, b, "empty");
}

const bulkBody = z.discriminatedUnion(
  "op",
  [
    z.object({ op: z.literal("stage"), stage: z.enum(PIPELINE_STAGES, { message: "bad_stage" }), reason: trimmed(200) }),
    z.object({ op: z.literal("snooze"), days: snoozeDays }),
    z.object({ op: z.literal("read") }),
    z.object({ op: z.literal("unread") }),
  ],
  { errorMap: () => ({ message: "bad_op" }) },
);
const bulkIds = z
  .array(z.unknown(), { message: "bad_ids" })
  .transform((ids) => ids.filter((v): v is string => typeof v === "string").slice(0, 100))
  .refine((ids) => ids.length > 0, { message: "bad_ids" });

export type BulkInput = z.infer<typeof bulkBody> & { ids: string[] };

export function parseBulkBody(b: unknown): BulkInput | Err {
  const ids = parse(z.object({ ids: bulkIds }), b, "bad_ids");
  if ("error" in ids) return ids;
  const op = parse(bulkBody, b, "bad_op");
  return "error" in op ? op : { ...op, ids: ids.ids };
}

const digestSettingsBody = z
  .object({
    digestEnabled: z.boolean().optional(),
    digestHour: z
      .number()
      .int({ message: "digestHour must be 0-23" })
      .min(0, { message: "digestHour must be 0-23" })
      .max(23, { message: "digestHour must be 0-23" })
      .optional(),
    phone: z.string().trim().optional(),
    optIn: z.boolean().optional(),
  })
  .refine((o) => !o.optIn || Boolean(o.phone), { message: "Phone number required to opt in" });

export type DigestSettingsInput = z.infer<typeof digestSettingsBody>;

export function parseDigestSettingsBody(b: unknown): DigestSettingsInput | Err {
  return parse(digestSettingsBody, b, "bad_body");
}
