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

export function askBookingField(
  lang: "en" | "he",
  field: string,
  extras?: { hours?: string },
): string {
  const hours = extras?.hours?.trim() ?? "";
  const chat = copyFor(lang).chat;
  if (field === "name") return chat.askName;
  if (field === "email") return chat.askEmail;
  if (field === "phone") return chat.askPhone;
  if (field === "need") return chat.askNeed;
  if (field === "visit_kind") return chat.askVisitKind;
  if (field === "time_preference") return chat.askTime(hours);
  return chat.askFieldFallback(field);
}
