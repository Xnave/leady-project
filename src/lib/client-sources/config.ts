import { z } from "zod";
import type { DealDateStep } from "./dates";

export const skipRuleSchema = z.object({
  field: z.string().min(1),
  in: z.array(z.string()).default([]),
});

export const baseConfigSchema = z.object({
  defaultCountryCode: z.string().regex(/^\d{1,4}$/).default("972"),
  skip: z.array(skipRuleSchema).default([]),
});

export const dealDateStepSchema: z.ZodType<DealDateStep, z.ZodTypeDef, unknown> = z.object({
  field: z.string().min(1),
  offsetMonths: z.number().int().min(-120).max(120).default(0),
  confidence: z.enum(["high", "medium_high", "medium", "low"]),
  whenField: z.string().min(1).optional(),
  whenIn: z.array(z.string()).optional(),
});
