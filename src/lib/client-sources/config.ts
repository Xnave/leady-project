import { z } from "zod";
import type { DealDateStep } from "./dates";

export const skipRuleSchema = z.object({
  field: z.string().min(1),
  in: z.array(z.string()).default([]),
});

/**
 * Which clients are relevant enough to store. Every part that is set must match.
 * A field rule with an empty `in` list is ignored (it does not filter anything).
 * Clients already stored are never removed by these rules; they keep syncing.
 */
export const keepRuleSchema = z.object({
  /** Deal date between `min` and `max` years ago (inclusive). A client with no deal date fails it. */
  dealYearsAgo: z
    .object({ min: z.number().min(0).max(100).optional(), max: z.number().min(0).max(100).optional() })
    .optional(),
  fields: z.array(skipRuleSchema).default([]),
});

export const baseConfigSchema = z.object({
  defaultCountryCode: z.string().regex(/^\d{1,4}$/).default("972"),
  skip: z.array(skipRuleSchema).default([]),
  keep: keepRuleSchema.default({}),
});

export const dealDateStepSchema: z.ZodType<DealDateStep, z.ZodTypeDef, unknown> = z.object({
  field: z.string().min(1),
  offsetMonths: z.number().int().min(-120).max(120).default(0),
  confidence: z.enum(["high", "medium_high", "medium", "low"]),
  whenField: z.string().min(1).optional(),
  whenIn: z.array(z.string()).optional(),
});
