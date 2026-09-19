/** One implementation per field type. Adding a vertical must never touch this file. */
import { copyFor } from "@/lib/copy";
import { formatPhoneDisplay, isCustomerNameSatisfied } from "@/lib/leads";
import { isSlotWithinVenueHours } from "../venue-hours";
import type { LeadFields } from "../types";
import type {
  DateFieldSpec,
  DateRangeFieldSpec,
  DateTimeTextFieldSpec,
  EmailFieldSpec,
  EnumFieldSpec,
  FieldContext,
  FieldHandler,
  FieldLang,
  FieldSpec,
  FieldTypeId,
  NormalizeResult,
  NumberFieldSpec,
  PhoneFieldSpec,
  TextFieldSpec,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse loose customer date wording into YYYY-MM-DD when possible. */
export function normalizeDateValue(raw: string, now: Date = new Date()): string | null {
  const t = raw.trim();
  if (ISO_DATE.test(t)) return t;
  const m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const lower = t.toLowerCase();
  if (lower === "today" || t === "היום") return toIsoDate(now);
  if (lower === "tomorrow" || t === "מחר") {
    const n = new Date(now);
    n.setDate(n.getDate() + 1);
    return toIsoDate(n);
  }
  return null;
}

export function isDateRangeValid(start: string, end: string): boolean {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) return false;
  return start < end;
}

export function looksLikePhoneNumber(value: string): boolean {
  return /^\+?\d[\d\s-]{7,}\d$/.test(value.trim());
}

/** Basic email shape — rejects incomplete values like "nave@". */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function str(fields: LeadFields, key: string): string {
  return String(fields[key] ?? "").trim();
}

/** Label for one owned key: spec labels → endpoint labels → caller fallback → humanised id. */
export function resolveLabel(
  spec: FieldSpec,
  key: string,
  fctx: FieldContext,
): string {
  if (spec.type === "date_range") {
    const endpoint = spec.endpointLabels?.[key]?.[fctx.lang]?.trim();
    if (endpoint) return endpoint;
  }
  if (key === spec.id) {
    const own = spec.labels?.[fctx.lang]?.trim();
    if (own) return own;
  }
  const fallback = fctx.labelFallback?.[key]?.trim();
  if (fallback) return fallback;
  return key.replaceAll("_", " ");
}

/** Ask text for one owned key: spec prompt → capability fallback → generic by label. */
function resolveAsk(
  spec: FieldSpec,
  key: string,
  fctx: FieldContext,
  generic?: (label: string) => string,
): string {
  if (key === spec.id) {
    const own = spec.prompts?.[fctx.lang]?.trim();
    if (own) return own;
  }
  const fromCapability = fctx.askFallback?.(spec, key, fctx.lang)?.trim();
  if (fromCapability) return fromCapability;
  const label = resolveLabel(spec, key, fctx);
  if (generic) return generic(label);
  return copyFor(fctx.lang).chat.askFieldFallback(label);
}

function satisfied(fields: LeadFields, spec: FieldSpec, key: string): boolean {
  if (spec.satisfy === "full_name") return isCustomerNameSatisfied(fields, key);
  return Boolean(str(fields, key));
}

function singleKeyConfirm(
  fields: LeadFields,
  spec: FieldSpec,
  fctx: FieldContext,
): { label: string; value: string }[] {
  const value = str(fields, spec.id);
  if (!value) return [];
  return [{ label: resolveLabel(spec, spec.id, fctx), value }];
}

const textHandler: FieldHandler<TextFieldSpec> = {
  type: "text",
  keys: (spec) => [spec.id],
  gaps: (fields, spec) => (satisfied(fields, spec, spec.id) ? [] : [spec.id]),
  ask: (spec, key, fctx) => resolveAsk(spec, key, fctx),
  normalize: (raw) => ({ ok: true, value: raw.trim() }),
  renderConfirm: singleKeyConfirm,
};

const dateHandler: FieldHandler<DateFieldSpec> = {
  type: "date",
  keys: (spec) => [spec.id],
  gaps: (fields, spec) => {
    const v = str(fields, spec.id);
    return v && ISO_DATE.test(v) ? [] : [spec.id];
  },
  ask: (spec, key, fctx) => resolveAsk(spec, key, fctx),
  normalize: (raw, _key, _spec, fctx) => {
    const iso = normalizeDateValue(raw, fctx.now);
    if (!iso) return { ok: false, error: "invalid_date" };
    return { ok: true, value: iso };
  },
  renderConfirm: singleKeyConfirm,
};

const dateRangeHandler: FieldHandler<DateRangeFieldSpec> = {
  type: "date_range",
  keys: (spec) => [spec.startId, spec.endId],
  gaps: (fields, spec) => {
    const start = str(fields, spec.startId);
    const end = str(fields, spec.endId);
    const out: string[] = [];
    if (!start || !ISO_DATE.test(start)) out.push(spec.startId);
    if (!end || !ISO_DATE.test(end)) out.push(spec.endId);
    // Both parse but the span is inverted — re-ask the end.
    if (out.length === 0 && !isDateRangeValid(start, end)) out.push(spec.endId);
    return out;
  },
  ask: (spec, key, fctx) => resolveAsk(spec, key, fctx),
  normalize: (raw, _key, _spec, fctx) => {
    const iso = normalizeDateValue(raw, fctx.now);
    if (!iso) return { ok: false, error: "invalid_date" };
    return { ok: true, value: iso };
  },
  renderConfirm: (fields, spec, fctx) => {
    const out: { label: string; value: string }[] = [];
    for (const key of [spec.startId, spec.endId]) {
      const value = str(fields, key);
      if (value) out.push({ label: resolveLabel(spec, key, fctx), value });
    }
    return out;
  },
};

const dateTimeTextHandler: FieldHandler<DateTimeTextFieldSpec> = {
  type: "datetime_text",
  keys: (spec) => [spec.id],
  gaps: (fields, spec) => (satisfied(fields, spec, spec.id) ? [] : [spec.id]),
  ask: (spec, key, fctx) =>
    resolveAsk(spec, key, fctx, () =>
      copyFor(fctx.lang).chat.askTime(fctx.businessHours?.trim() ?? ""),
    ),
  normalize: (raw, _key, spec, fctx) => {
    const value = raw.trim();
    const hours = fctx.businessHours?.trim() ?? "";
    if (!spec.withinBusinessHours || !hours) return { ok: true, value };
    if (isSlotWithinVenueHours(value, hours, { lang: fctx.lang }) === false) {
      return {
        ok: false,
        error: "outside_hours",
        reask: copyFor(fctx.lang).chat.askTimeOutsideHours(hours),
        hint: "Ask only for another day/time inside opening hours. Do not ask for other fields until this is saved.",
      };
    }
    return { ok: true, value };
  },
  renderConfirm: singleKeyConfirm,
};

const enumHandler: FieldHandler<EnumFieldSpec> = {
  type: "enum",
  keys: (spec) => [spec.id],
  gaps: (fields, spec) => (satisfied(fields, spec, spec.id) ? [] : [spec.id]),
  ask: (spec, key, fctx) => {
    if (key === spec.id && spec.prompts?.[fctx.lang]?.trim()) {
      return spec.prompts[fctx.lang]!.trim();
    }
    const fromCapability = fctx.askFallback?.(spec, key, fctx.lang)?.trim();
    if (fromCapability) return fromCapability;
    const label = resolveLabel(spec, key, fctx);
    if (spec.options.length) {
      return copyFor(fctx.lang).chat.askFieldWithOptions(
        label,
        spec.options.map((o) => o.label).join(" · "),
      );
    }
    return copyFor(fctx.lang).chat.askFieldFallback(label);
  },
  normalize: (raw, _key, spec) => {
    const v = raw.trim();
    if (!v) return { ok: true, value: "" };
    const match = spec.options.find(
      (o) =>
        o.id === v ||
        o.label === v ||
        o.label.toLowerCase() === v.toLowerCase() ||
        o.id.toLowerCase() === v.toLowerCase(),
    );
    // Unknown values pass through: tenants use free text and the agent asks in their words.
    return { ok: true, value: match ? match.id : v };
  },
  renderConfirm: (fields, spec, fctx) => {
    const raw = str(fields, spec.id);
    if (!raw) return [];
    const opt = spec.options.find((o) => o.id === raw);
    return [{ label: resolveLabel(spec, spec.id, fctx), value: opt?.label ?? raw }];
  },
};

const numberHandler: FieldHandler<NumberFieldSpec> = {
  type: "number",
  keys: (spec) => [spec.id],
  gaps: (fields, spec) => (satisfied(fields, spec, spec.id) ? [] : [spec.id]),
  ask: (spec, key, fctx) => resolveAsk(spec, key, fctx),
  normalize: (raw, _key, spec) => {
    const v = raw.trim();
    if (!v) return { ok: true, value: "" };
    const digits = v.match(/-?\d+/)?.[0];
    const n = digits ? Number(digits) : Number.NaN;
    if (!Number.isFinite(n)) return { ok: false, error: "invalid_number" };
    if (spec.min !== undefined && n < spec.min) {
      return { ok: false, error: "below_min", hint: `Minimum is ${spec.min}.` };
    }
    if (spec.max !== undefined && n > spec.max) {
      return { ok: false, error: "above_max", hint: `Maximum is ${spec.max}.` };
    }
    return { ok: true, value: String(n) };
  },
  renderConfirm: singleKeyConfirm,
};

const phoneHandler: FieldHandler<PhoneFieldSpec> = {
  type: "phone",
  keys: (spec) => [spec.id],
  gaps: (fields, spec) => (str(fields, spec.id) ? [] : [spec.id]),
  ask: (spec, key, fctx) =>
    resolveAsk(spec, key, fctx, () => {
      const chat = copyFor(fctx.lang).chat;
      const deduced = fctx.deducedPhone?.trim();
      return deduced
        ? chat.askPhoneConfirm(formatPhoneDisplay(deduced) || deduced)
        : chat.askPhone;
    }),
  normalize: (raw, _key, _spec, fctx) => {
    const v = raw.trim();
    if (!v) return { ok: true, value: "" };
    // The deduced channel number is trusted even when it fails the loose shape test.
    if (!looksLikePhoneNumber(v) && v !== fctx.deducedPhone) {
      return { ok: false, error: "invalid_phone" };
    }
    return { ok: true, value: v };
  },
  renderConfirm: (fields, spec, fctx) => {
    const raw = str(fields, spec.id);
    if (!raw) return [];
    return [
      {
        label: resolveLabel(spec, spec.id, fctx),
        value: formatPhoneDisplay(raw) || raw,
      },
    ];
  },
};

const emailHandler: FieldHandler<EmailFieldSpec> = {
  type: "email",
  keys: (spec) => [spec.id],
  gaps: (fields, spec) => (str(fields, spec.id) ? [] : [spec.id]),
  ask: (spec, key, fctx) =>
    resolveAsk(spec, key, fctx, () => copyFor(fctx.lang).chat.askEmail),
  normalize: (raw, _key, _spec, fctx) => {
    const v = raw.trim();
    if (!v) return { ok: true, value: "" };
    if (!looksLikeEmail(v)) {
      return {
        ok: false,
        error: "invalid_email",
        reask: copyFor(fctx.lang).chat.askEmail,
        hint: "Ask again for a complete email only. Do not ask other fields until email is valid.",
      };
    }
    return { ok: true, value: v };
  },
  renderConfirm: singleKeyConfirm,
};

const handlers: { [K in FieldTypeId]: FieldHandler<Extract<FieldSpec, { type: K }>> } = {
  text: textHandler,
  date: dateHandler,
  date_range: dateRangeHandler,
  datetime_text: dateTimeTextHandler,
  enum: enumHandler,
  number: numberHandler,
  phone: phoneHandler,
  email: emailHandler,
};

export function handlerFor<S extends FieldSpec>(spec: S): FieldHandler<S> {
  return handlers[spec.type] as unknown as FieldHandler<S>;
}

export type { FieldLang, NormalizeResult };
