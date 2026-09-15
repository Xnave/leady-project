import { copyFor } from "@/lib/copy";
import { formatPhoneDisplay, isCustomerNameSatisfied } from "@/lib/leads";
import { missingRequired } from "./helpers";
import type { LeadFields } from "./types";

export function bookingFieldGaps(
  fields: LeadFields,
  required: string[] = ["time_preference", "name", "need"],
): string[] {
  const contactKeys = new Set(["phone", "email"]);
  const withoutName = required.filter((key) => key !== "name" && !contactKeys.has(key));
  const missing = missingRequired(fields, withoutName);
  if (required.includes("name") && !isCustomerNameSatisfied(fields)) {
    // Keep name near the front of the gap list (after time when both missing).
    const timeIdx = missing.indexOf("time_preference");
    if (timeIdx >= 0) missing.splice(timeIdx + 1, 0, "name");
    else missing.unshift("name");
  }
  if (required.includes("phone") && !String(fields.phone ?? "").trim()) {
    missing.push("phone");
  }
  if (required.includes("email") && !String(fields.email ?? "").trim()) {
    missing.push("email");
  }
  return missing;
}

const FIELD_LABELS: Record<"en" | "he", Record<string, string>> = {
  en: {
    time_preference: "a day and time",
    name: "a name",
    need: "what the visit is for",
    phone: "a phone number",
    email: "an email",
    visit_kind: "the visit type",
  },
  he: {
    time_preference: "יום ושעה",
    name: "שם",
    need: "פרטי הפגישה",
    phone: "מספר טלפון",
    email: "אימייל",
    visit_kind: "סוג ביקור",
  },
};

export function bookingFieldLabel(lang: "en" | "he", field: string): string {
  return FIELD_LABELS[lang][field] ?? field.replaceAll("_", " ");
}

/** Canned field prompts used by the ask_field tool (templates, not dialogue policy). */
export function askBookingField(
  lang: "en" | "he",
  field: string,
  extras?: { hours?: string; deducedPhone?: string },
): string {
  const hours = extras?.hours?.trim() ?? "";
  const chat = copyFor(lang).chat;
  if (field === "name") return chat.askName;
  if (field === "email") return chat.askEmail;
  if (field === "phone") {
    const deduced = extras?.deducedPhone?.trim();
    return deduced
      ? chat.askPhoneConfirm(formatPhoneDisplay(deduced) || deduced)
      : chat.askPhone;
  }
  if (field === "need") return chat.askNeed;
  if (field === "visit_kind") return chat.askVisitKind;
  if (field === "time_preference") return chat.askTime(hours);
  return chat.askFieldFallback(bookingFieldLabel(lang, field));
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
] as const;

export type BookingSessionFieldKey = (typeof BOOKING_SESSION_FIELD_KEYS)[number];

export function isBookingSessionKey(key: string): key is BookingSessionFieldKey {
  return (BOOKING_SESSION_FIELD_KEYS as readonly string[]).includes(key);
}

/** Split a merged working bag into durable CRM vs per-conversation session. */
export function splitCrmAndSession(fields: LeadFields): {
  crm: LeadFields;
  session: LeadFields;
} {
  const crm: LeadFields = {};
  const session: LeadFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isBookingSessionKey(key)) session[key] = value;
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
