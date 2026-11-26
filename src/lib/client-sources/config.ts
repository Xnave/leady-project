import { z } from "zod";
import type { StartedAtStep } from "./dates";

export const skipRuleSchema = z.object({
  field: z.string().min(1),
  in: z.array(z.string()).default([]),
});

/**
 * Which clients are relevant enough to store. Every part that is set must match.
 * A field rule with an empty `in` list is ignored (it does not filter anything).
 * Clients already stored are never removed by these rules. freezeAfterFirstSync leaves them as first stored.
 */
export const keepRuleSchema = z.object({
  /** Client for between `min` and `max` years (inclusive). A client with no start date fails it. */
  startedYearsAgo: z
    .object({ min: z.number().min(0).max(100).optional(), max: z.number().min(0).max(100).optional() })
    .optional(),
  fields: z.array(skipRuleSchema).default([]),
});

export const baseConfigSchema = z.object({
  defaultCountryCode: z.string().regex(/^\d{1,4}$/).default("972"),
  skip: z.array(skipRuleSchema).default([]),
  keep: keepRuleSchema.default({}),
  storeRaw: z.boolean().default(true),
  freezeAfterFirstSync: z.boolean().default(false),
});

export const startedAtStepSchema: z.ZodType<StartedAtStep, z.ZodTypeDef, unknown> = z.object({
  field: z.string().min(1),
  offsetMonths: z.number().int().min(-120).max(120).default(0),
  confidence: z.enum(["high", "medium_high", "medium", "low"]),
  whenField: z.string().min(1).optional(),
  whenIn: z.array(z.string()).optional(),
});

/** Saved sources and drafts still use the old dealDate names. */
export function withStartedAtAliases<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const o = { ...(raw as Record<string, unknown>) };
    if (o.startedAt == null && o.dealDate != null) o.startedAt = o.dealDate;
    if (o.keep && typeof o.keep === "object") {
      const keep = { ...(o.keep as Record<string, unknown>) };
      if (keep.startedYearsAgo == null && keep.dealYearsAgo != null) keep.startedYearsAgo = keep.dealYearsAgo;
      o.keep = keep;
    }
    return o;
  }, schema);
}
