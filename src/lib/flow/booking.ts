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
    return deduced ? chat.askPhoneConfirm(deduced) : chat.askPhone;
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
