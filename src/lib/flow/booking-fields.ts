/**
 * The booking capability's collect list expressed as typed field specs.
 *
 * This is the bridge from the legacy `required_for_book` string ids to the field kit.
 * The canned per-field wording still lives in `src/lib/copy` and is supplied through
 * `askFallback`, so behavior is unchanged while the mechanics move to the kit.
 */
import { copyFor } from "@/lib/copy";
import { callbackPhone } from "./booking-collect";
import { venueHoursFromCtx } from "./booking-config";
import type { FieldContext, FieldSpec } from "./fields";
import type { LeadFields, TurnContext } from "./types";

/** Contact fields are always asked last, after the visit details. */
const CONTACT_IDS = ["phone", "email"] as const;

function specFor(id: string): FieldSpec {
  switch (id) {
    case "time_preference":
      return { id, type: "datetime_text", withinBusinessHours: true };
    case "name":
      return { id, type: "text", satisfy: "full_name" };
    case "phone":
      return { id, type: "phone" };
    case "email":
      return { id, type: "email" };
    default:
      return { id, type: "text" };
  }
}

/**
 * Specs in the order gaps must be asked: time, name, other details, then contact.
 * Mirrors the ordering the previous hand-written gap builder produced.
 */
export function bookingFieldSpecs(required: string[]): FieldSpec[] {
  const ordered: string[] = [];
  const push = (id: string) => {
    if (required.includes(id) && !ordered.includes(id)) ordered.push(id);
  };
  push("time_preference");
  push("name");
  for (const id of required) {
    if (id === "time_preference" || id === "name") continue;
    if ((CONTACT_IDS as readonly string[]).includes(id)) continue;
    if (!ordered.includes(id)) ordered.push(id);
  }
  for (const id of CONTACT_IDS) push(id);
  return ordered.map(specFor);
}

/** Canned booking wording, consulted by the kit before its generic asks. */
function bookingAskFallback(
  _spec: FieldSpec,
  key: string,
  lang: "en" | "he",
): string | undefined {
  const chat = copyFor(lang).chat;
  if (key === "name") return chat.askName;
  if (key === "need") return chat.askNeed;
  if (key === "visit_kind") return chat.askVisitKind;
  return undefined;
}

const BOOKING_LABEL_FALLBACK: Record<"en" | "he", Record<string, string>> = {
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

export function bookingFieldContext(opts: {
  lang: "en" | "he";
  hours?: string;
  deducedPhone?: string;
  now?: Date;
}): FieldContext {
  return {
    lang: opts.lang,
    businessHours: opts.hours,
    deducedPhone: opts.deducedPhone,
    now: opts.now,
    askFallback: bookingAskFallback,
    labelFallback: BOOKING_LABEL_FALLBACK[opts.lang],
  };
}

/** Field context for a live turn, deducing the callback phone from the channel. */
export function bookingFieldContextFromCtx(
  ctx: TurnContext,
  lang: "en" | "he",
  opts?: { forKey?: string },
): FieldContext {
  return bookingFieldContext({
    lang,
    hours: venueHoursFromCtx(ctx),
    // Only offer the deduced number when the phone itself is being asked.
    deducedPhone: opts?.forKey === "phone" ? callbackPhone(ctx) : undefined,
  });
}

export type { LeadFields };
