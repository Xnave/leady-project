import { copyFor } from "@/lib/copy";
import { missingRequired } from "./helpers";
import type { LeadFields } from "./types";

export function bookingFieldGaps(
  fields: LeadFields,
  required: string[] = ["time_preference", "name", "need"],
): string[] {
  const contactKeys = new Set(["phone", "email"]);
  const missing = missingRequired(
    fields,
    required.filter((key) => !contactKeys.has(key)),
  );
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
    need: "את מטרת הפגישה",
    phone: "מספר טלפון",
    email: "אימייל",
    visit_kind: "סוג ביקור",
  },
};

export function bookingFieldLabel(lang: "en" | "he", field: string): string {
  return FIELD_LABELS[lang][field] ?? field.replaceAll("_", " ");
}

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
    return deduced ? chat.askPhoneConfirm(deduced) : chat.askPhone;
  }
  if (field === "need") return chat.askNeed;
  if (field === "visit_kind") return chat.askVisitKind;
  if (field === "time_preference") return chat.askTime(hours);
  return chat.askFieldFallback(bookingFieldLabel(lang, field));
}

/** Safety only: clear book flag when gaps remain. Never rewrite reply text. */
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

/** True once we already started a visit request (fields or confirm), not on plain FAQ turns. */
export function isMidBookingCollect(
  fields: LeadFields,
  required: string[] = ["time_preference", "name", "need"],
): boolean {
  // Waiting on a staff-offered alternative — do not collect more booking fields.
  if (fields.staff_slot_offer && typeof fields.staff_slot_offer === "object") {
    return false;
  }
  if (bookingConfirmStatus(fields)) return true;
  return required.some((key) => String(fields[key] ?? "").trim().length > 0);
}

/** Which booking field the agent message was asking for (canned ask_field texts). */
export function matchAskedBookingField(
  agentText: string,
  lang: "en" | "he",
  fields: string[],
  extras?: { hours?: string; deducedPhone?: string },
): string | undefined {
  const text = agentText.trim();
  if (!text) return undefined;
  const candidates = [...fields].sort(
    (a, b) =>
      askBookingField(lang, b, extras).length - askBookingField(lang, a, extras).length,
  );
  for (const field of candidates) {
    const ask = askBookingField(lang, field, extras);
    if (text === ask || text.includes(ask)) return field;
  }
  if (fields.includes("time_preference")) {
    const bare = askBookingField(lang, "time_preference", {});
    if (text === bare || text.includes(bare)) return "time_preference";
  }
  return undefined;
}

/**
 * When the prior agent turn asked for a still-empty booking field and the customer
 * answered, capture their wording as-is (no date parsing). The LLM may clear or
 * replace via save_fields if it decides the answer is unusable.
 */
export function capturePriorBookingAnswer(opts: {
  priorAgentText: string;
  customerText: string;
  fields: LeadFields;
  required: string[];
  lang: "en" | "he";
  hours?: string;
  deducedPhone?: string;
}): LeadFields {
  const customer = opts.customerText.trim();
  if (!customer) return {};
  const prior = matchAskedBookingField(opts.priorAgentText, opts.lang, opts.required, {
    hours: opts.hours,
    deducedPhone: opts.deducedPhone,
  });
  if (!prior) return {};
  if (String(opts.fields[prior] ?? "").trim()) return {};
  return { [prior]: customer };
}
