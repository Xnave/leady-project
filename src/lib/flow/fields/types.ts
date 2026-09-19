/**
 * Typed field kit.
 *
 * A capability describes what it collects as a list of {@link FieldSpec}, and every
 * behavior that used to be written per field id — how to ask for it, how to coerce the
 * customer's wording, whether it is satisfied, how it reads in a confirmation summary
 * and in the CRM — is implemented once per *type* in `handlers.ts`.
 *
 * Adding a vertical is then a config change: a JSON array of specs, no new code.
 */
import type { LeadFields } from "../types";

export type FieldTypeId =
  | "text"
  | "date"
  | "date_range"
  | "datetime_text"
  | "enum"
  | "number"
  | "phone"
  | "email";

export type FieldLang = "en" | "he";

export type FieldOption = {
  id: string;
  label: string;
  /** Optional capacity hint, e.g. max guests for a unit. */
  max?: number;
};

/**
 * How "filled in" is decided.
 * - `non_empty` (default): any non-blank value counts.
 * - `full_name`: rejects nickname-only / single-token values unless the agent has
 *   already collected and confirmed the name in this conversation.
 */
export type SatisfyRule = "non_empty" | "full_name";

export type FieldSpecBase = {
  id: string;
  /** Operator-supplied label per language. Falls back to generic copy, then the id. */
  labels?: Partial<Record<FieldLang, string>>;
  /** Operator-supplied question per language. Falls back to the type's generic ask. */
  prompts?: Partial<Record<FieldLang, string>>;
  satisfy?: SatisfyRule;
};

export type TextFieldSpec = FieldSpecBase & { type: "text" };
export type DateFieldSpec = FieldSpecBase & { type: "date" };

/**
 * A span. Owns two keys in the fields bag and validates start < end.
 * A villa stay, a dress rental window and an equipment hire are all this type.
 */
export type DateRangeFieldSpec = FieldSpecBase & {
  type: "date_range";
  startId: string;
  endId: string;
  /** Labels/prompts for the two ends, keyed by the owned field id. */
  endpointLabels?: Partial<Record<string, Partial<Record<FieldLang, string>>>>;
};

/** Free-text day+time wording ("Thursday evening"), optionally gated on business hours. */
export type DateTimeTextFieldSpec = FieldSpecBase & {
  type: "datetime_text";
  withinBusinessHours?: boolean;
};

export type EnumFieldSpec = FieldSpecBase & {
  type: "enum";
  options: FieldOption[];
};

export type NumberFieldSpec = FieldSpecBase & {
  type: "number";
  min?: number;
  max?: number;
};

export type PhoneFieldSpec = FieldSpecBase & { type: "phone" };
export type EmailFieldSpec = FieldSpecBase & { type: "email" };

export type FieldSpec =
  | TextFieldSpec
  | DateFieldSpec
  | DateRangeFieldSpec
  | DateTimeTextFieldSpec
  | EnumFieldSpec
  | NumberFieldSpec
  | PhoneFieldSpec
  | EmailFieldSpec;

/** Per-turn inputs the handlers need but must not import. */
export type FieldContext = {
  lang: FieldLang;
  /** Free-text business hours, for `datetime_text` gating. */
  businessHours?: string;
  /** Phone deduced from the channel, for a confirm-style phone ask. */
  deducedPhone?: string;
  now?: Date;
  /**
   * Canned per-field copy kept by a capability while its wording still lives in
   * `src/lib/copy`. Consulted before the type's generic ask.
   */
  askFallback?: (spec: FieldSpec, key: string, lang: FieldLang) => string | undefined;
  /** Generic label copy per field id, consulted before the raw id. */
  labelFallback?: Record<string, string>;
};

export type NormalizeOk = { ok: true; value: string };

export type NormalizeError = {
  ok: false;
  /** Stable machine reason, e.g. `invalid_email`, `outside_hours`. */
  error: string;
  /** Customer-facing re-ask, when the type knows a better one than the plain ask. */
  reask?: string;
  /** Extra guidance surfaced to the model in tool output. */
  hint?: string;
};

export type NormalizeResult = NormalizeOk | NormalizeError;

export type FieldHandler<S extends FieldSpec = FieldSpec> = {
  type: S["type"];
  /** Keys this field owns in the fields bag. Most own one; `date_range` owns two. */
  keys: (spec: S) => string[];
  /** Owned keys still missing or malformed, in the order they should be asked. */
  gaps: (fields: LeadFields, spec: S, fctx: FieldContext) => string[];
  /** The question for one owned key. */
  ask: (spec: S, key: string, fctx: FieldContext) => string;
  /** Coerce raw customer wording into the stored form for one owned key. */
  normalize: (raw: string, key: string, spec: S, fctx: FieldContext) => NormalizeResult;
  /** Confirmation summary lines, one per owned key that has a value. */
  renderConfirm: (
    fields: LeadFields,
    spec: S,
    fctx: FieldContext,
  ) => { label: string; value: string }[];
};
