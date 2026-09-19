/**
 * Public API of the typed field kit.
 *
 * Capabilities work in terms of a `FieldSpec[]` and call these functions; they never
 * branch on a field id. See `./types.ts` for the spec shape and `./handlers.ts` for
 * the one-per-type implementations.
 */
import type { LeadFields } from "../types";
import { handlerFor, resolveLabel } from "./handlers";
import type {
  FieldContext,
  FieldLang,
  FieldOption,
  FieldSpec,
  NormalizeResult,
} from "./types";

export type {
  DateFieldSpec,
  DateRangeFieldSpec,
  DateTimeTextFieldSpec,
  EmailFieldSpec,
  EnumFieldSpec,
  FieldContext,
  FieldHandler,
  FieldLang,
  FieldOption,
  FieldSpec,
  FieldSpecBase,
  FieldTypeId,
  NormalizeError,
  NormalizeOk,
  NormalizeResult,
  NumberFieldSpec,
  PhoneFieldSpec,
  SatisfyRule,
  TextFieldSpec,
} from "./types";

export {
  handlerFor,
  isDateRangeValid,
  looksLikeEmail,
  looksLikePhoneNumber,
  normalizeDateValue,
  resolveLabel,
  toIsoDate,
} from "./handlers";

/** Every key the given specs own in the fields bag. */
export function fieldKeys(specs: FieldSpec[]): string[] {
  const keys: string[] = [];
  for (const spec of specs) {
    for (const key of handlerFor(spec).keys(spec)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** Find the spec that owns a key. */
export function specForKey(specs: FieldSpec[], key: string): FieldSpec | undefined {
  return specs.find((spec) => handlerFor(spec).keys(spec).includes(key));
}

/**
 * Keys still missing or malformed, in spec order.
 * Replaces the per-domain `*FieldGaps` helpers.
 */
export function fieldGaps(
  specs: FieldSpec[],
  fields: LeadFields,
  fctx: FieldContext,
): string[] {
  const gaps: string[] = [];
  for (const spec of specs) {
    for (const key of handlerFor(spec).gaps(fields, spec, fctx)) {
      if (!gaps.includes(key)) gaps.push(key);
    }
  }
  return gaps;
}

export function isComplete(
  specs: FieldSpec[],
  fields: LeadFields,
  fctx: FieldContext,
): boolean {
  return fieldGaps(specs, fields, fctx).length === 0;
}

/** The question for one key. Unknown keys fall back to a generic ask. */
export function askField(
  specs: FieldSpec[],
  key: string,
  fctx: FieldContext,
): string | undefined {
  const spec = specForKey(specs, key);
  if (!spec) return undefined;
  return handlerFor(spec).ask(spec, key, fctx);
}

/** Coerce raw customer wording for one key. Unknown keys are rejected. */
export function normalizeField(
  specs: FieldSpec[],
  key: string,
  raw: string,
  fctx: FieldContext,
): NormalizeResult {
  const spec = specForKey(specs, key);
  if (!spec) return { ok: false, error: "unknown_field" };
  return handlerFor(spec).normalize(raw, key, spec, fctx);
}

/**
 * Normalize a batch of raw values, keeping the first failure.
 * Values for keys outside the specs are dropped rather than stored.
 */
export function normalizeFields(
  specs: FieldSpec[],
  raw: Record<string, string>,
  fctx: FieldContext,
): { values: LeadFields; failure?: { key: string; result: NormalizeResult } } {
  const values: LeadFields = {};
  let failure: { key: string; result: NormalizeResult } | undefined;
  for (const [key, value] of Object.entries(raw)) {
    if (!specForKey(specs, key)) continue;
    if (!value.trim()) {
      values[key] = "";
      continue;
    }
    const result = normalizeField(specs, key, value, fctx);
    if (!result.ok) {
      failure ??= { key, result };
      continue;
    }
    values[key] = result.value;
  }
  return { values, failure };
}

/** Label for one key, for confirmations and the CRM. */
export function fieldLabel(
  specs: FieldSpec[],
  key: string,
  fctx: FieldContext,
): string {
  const spec = specForKey(specs, key);
  if (!spec) return fctx.labelFallback?.[key]?.trim() || key.replaceAll("_", " ");
  return resolveLabel(spec, key, fctx);
}

/** `label: value` pairs for the customer confirmation summary, in spec order. */
export function confirmLines(
  specs: FieldSpec[],
  fields: LeadFields,
  fctx: FieldContext,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const spec of specs) {
    out.push(...handlerFor(spec).renderConfirm(fields, spec, fctx));
  }
  return out;
}

/** Options for an enum key, for onboard UI and prompt hints. */
export function fieldOptions(specs: FieldSpec[], key: string): FieldOption[] {
  const spec = specForKey(specs, key);
  return spec?.type === "enum" ? spec.options : [];
}

/** Human-readable spec list for prompt sections, e.g. "check_in, check_out, guests". */
export function describeFields(specs: FieldSpec[]): string {
  return fieldKeys(specs).join(", ");
}

export type { LeadFields };
