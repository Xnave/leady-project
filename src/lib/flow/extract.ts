import { isGreetingOnly } from "./locale";
import type { LeadFields } from "./types";
import { missingRequired } from "./helpers";
import { extractTimePreference, extractVisitKind } from "./booking";

const PUSHBACK = /^(why|what|huh|wait|no\b|nope|stop|\?+$|למה|לא רוצה)/i;

export function isPushback(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || PUSHBACK.test(t) || isGreetingOnly(t);
}

/** If the user sent a short answer to the current slot, map it even without "my name is". */
export function assignBareReply(
  text: string,
  already: LeadFields,
  required: string[],
  extraKeys: string[],
): LeadFields {
  const trimmed = text.trim();
  if (isPushback(trimmed)) return {};
  const fromPatterns = patternExtract(trimmed, [...required, ...extraKeys]);
  if (Object.keys(fromPatterns).length > 0) return fromPatterns;

  const missing = missingRequired(already, required);
  const slot = missing[0];
  if (!slot) return {};

  if (slot === "name") {
    if (isPlausibleName(trimmed)) return { name: trimmed };
    return {};
  }
  if (slot === "email") {
    const email = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email) return { email: email[0] };
    return {};
  }
  if (trimmed.length > 0 && trimmed.length < 80) return { [slot]: trimmed };
  return {};
}

export function patternExtract(text: string, keys: string[]): LeadFields {
  const fields: LeadFields = {};
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email && keys.includes("email")) fields.email = email[0];
  const nameMatch = text.match(/(?:i(?:'|’)m|i am|my name is)\s+([A-Za-z][\w' -]{0,40})/i);
  if (nameMatch && keys.includes("name")) fields.name = nameMatch[1].trim();
  if (keys.includes("service")) {
    if (/remodel|שיפוץ/i.test(text)) fields.service = "remodel";
    else if (/repair|תיקון/i.test(text)) fields.service = "repair";
    else if (/דירה חדשה|מטבח חדש|מטבח ריק|^(חדש|new)[.!?]*$/i.test(text.trim())) {
      fields.service = "other";
    }
  }
  if (keys.includes("phone")) {
    const phone = text.match(/\+?\d[\d\s-]{7,}\d/);
    if (phone) fields.phone = phone[0].replaceAll(" ", "");
  }
  if (keys.includes("time_preference")) {
    const when = extractTimePreference(text);
    if (when) fields.time_preference = when;
  }
  if (keys.includes("visit_kind")) {
    const kind = extractVisitKind(text);
    if (kind) fields.visit_kind = kind;
  }
  if (keys.includes("name") && !fields.name && isPlausibleName(text.trim())) {
    fields.name = text.trim();
  }
  return fields;
}

function isPlausibleName(text: string): boolean {
  if (isPushback(text)) return false;
  if (text.includes("@")) return false;
  if (/^(חדש|שיפוץ|תיקון|כן|לא|yes|no|new|remodel|repair)$/i.test(text.trim())) {
    return false;
  }
  if (/לבוא|מדידה|פגישה|מטבח|אולם|סניף|רביעי|שלישי|visit|book/i.test(text)) {
    return false;
  }
  const words = text.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  return /^[\p{L}][\p{L}' -]{0,40}$/u.test(text);
}
