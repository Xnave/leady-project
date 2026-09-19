import { copyFor } from "@/lib/copy";
import { isCapabilitySessionKey } from "./registry";
import { bookingFieldContext, bookingFieldSpecs } from "./booking-fields";
import { askField, fieldGaps, fieldLabel } from "./fields";
import type { LeadFields } from "./types";

const DEFAULT_REQUIRED = ["time_preference", "name", "need"];

export function bookingFieldGaps(
  fields: LeadFields,
  required: string[] = DEFAULT_REQUIRED,
): string[] {
  return fieldGaps(
    bookingFieldSpecs(required),
    fields,
    // Gap detection never needs hours or a deduced phone, only satisfaction rules.
    bookingFieldContext({ lang: "en" }),
  );
}

export function bookingFieldLabel(lang: "en" | "he", field: string): string {
  return fieldLabel(
    bookingFieldSpecs([field]),
    field,
    bookingFieldContext({ lang }),
  );
}

/** Canned field prompts used by the ask_field tool (templates, not dialogue policy). */
export function askBookingField(
  lang: "en" | "he",
  field: string,
  extras?: { hours?: string; deducedPhone?: string },
): string {
  const fctx = bookingFieldContext({
    lang,
    hours: extras?.hours?.trim() ?? "",
    deducedPhone: extras?.deducedPhone?.trim(),
  });
  return (
    askField(bookingFieldSpecs([field]), field, fctx) ??
    copyFor(lang).chat.askFieldFallback(bookingFieldLabel(lang, field))
  );
}

/** Safety validator: clear book flag when gaps remain. */
export function gateBookOnGaps(opts: {
  book?: boolean;
  gaps: string[];
}): { book: boolean } {
  if (opts.book && opts.gaps.length > 0) return { book: false };
  return { book: Boolean(opts.book) };
}

export function bookingConfirmStatus(fields: LeadFields): "pending" | "confirmed" | "" {
  const v = String(fields.booking_confirm ?? "").trim().toLowerCase();
  if (v === "confirmed") return "confirmed";
  if (v === "pending") return "pending";
  return "";
}

/**
 * True once visit booking has actually started (not mere product interest).
 * CRM leftovers like name/phone/need from a prior visit must NOT keep booking open.
 */
export function isBookingCollectActive(
  fields: LeadFields,
  _required: string[] = ["time_preference", "name", "need"],
): boolean {
  if (fields.staff_slot_offer && typeof fields.staff_slot_offer === "object") {
    return true;
  }
  if (String(fields.booking_flow ?? "").trim() === "active") return true;
  if (bookingConfirmStatus(fields)) return true;
  return false;
}

/** Fields that belong to an in-progress booking — live on Conversation.session. */
export const BOOKING_SESSION_FIELD_KEYS = [
  "booking_flow",
  "booking_confirm",
  "booking",
  "time_preference",
  "staff_slot_offer",
  "need",
  "visit_kind",
  /** Keeps single-token names from re-entering gaps after the agent collected them. */
  "name_collected_by_agent",
] as const;

export type BookingSessionFieldKey = (typeof BOOKING_SESSION_FIELD_KEYS)[number];

export function isBookingSessionKey(key: string): key is BookingSessionFieldKey {
  return (BOOKING_SESSION_FIELD_KEYS as readonly string[]).includes(key);
}

/** Prefer capability-registered session keys; fall back to booking keys before registry boot. */
export function isSessionFieldKey(key: string, extraSessionKeys?: readonly string[]): boolean {
  if (extraSessionKeys?.includes(key)) return true;
  if (isCapabilitySessionKey(key)) return true;
  return isBookingSessionKey(key);
}

/** Split a merged working bag into durable CRM vs per-conversation session. */
export function splitCrmAndSession(
  fields: LeadFields,
  extraSessionKeys?: readonly string[],
): {
  crm: LeadFields;
  session: LeadFields;
} {
  const crm: LeadFields = {};
  const session: LeadFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSessionFieldKey(key, extraSessionKeys)) session[key] = value;
    else crm[key] = value;
  }
  return { crm, session };
}

export function mergeLeadAndSession(crm: LeadFields, session: LeadFields): LeadFields {
  return { ...crm, ...session };
}

/** Strip session keys from Lead.fields (compat / migration). Prefer Conversation.session. */
export function clearBookingSessionFields(fields: LeadFields): LeadFields {
  const next = { ...fields };
  for (const key of BOOKING_SESSION_FIELD_KEYS) {
    delete next[key];
  }
  return next;
}
