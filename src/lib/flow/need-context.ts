/**
 * Booking "need" / פרטי הפגישה helpers.
 * `interest` is the understanding saved by the talk turn. An exact paste of a lead message is ignored.
 */

import { looksLikeShortAffirmation } from "./affirm";
import type { LeadFields, MessageSnapshot } from "./types";

/** CRM field: concrete context from early chat, before booking session `need` is filled. */
export function gatheredInterest(fields: LeadFields): string {
  return String(fields.interest ?? "").trim();
}

function compact(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when interest is an exact copy of a lead message, not an understanding. */
export function interestCopiesLeadMessage(
  interest: string,
  messages: readonly MessageSnapshot[],
): boolean {
  const needle = compact(interest);
  if (!needle) return false;
  return messages.some((m) => m.role === "lead" && compact(m.text) === needle);
}

/**
 * Understanding already stored on the lead.
 * An exact paste of a lead message does not count and is not rewritten here.
 */
export function storedUnderstanding(
  fields: LeadFields,
  messages?: readonly MessageSnapshot[],
): string {
  const interest = gatheredInterest(fields);
  if (!interest) return "";
  if (messages && interestCopiesLeadMessage(interest, messages)) return "";
  return interest;
}

/** Pointer phrases that must not be stored as meeting details. */
export function looksLikeNeedDeixis(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  return (
    /מה\s*שכתבתי|כמו\s*שכתבתי|כנ["']ל|כפי\s*שציינתי|כפי\s*שאמרתי/i.test(t) ||
    /^(as\s+(i\s+)?(said|wrote|mentioned)|same\s+as\s+(above|before)|see\s+above|what\s+i\s+(said|wrote)|as\s+above)\b/i.test(
      t,
    )
  );
}

/** Customer declines adding more after we presented gathered context. */
export function looksLikeNothingToAdd(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  return /^(לא|לא\.|אין|אין לי|זהו|מספיק|כלום|לא צריך|אין מה להוסיף|אין לי מה להוסיף|זה הכל|זהו זה)[!?.]*$/iu.test(
    t,
  ) ||
    /^(no|nope|nothing|nothing else|that's all|thats all|all good|no thanks|n\/a)[!?.]*$/iu.test(t);
}

/**
 * Resolve a customer reply into the durable `need` value.
 * Prefers appending extras onto gathered interest; never stores deixis literally.
 */
export function resolveNeedFromReply(
  raw: string,
  gathered: string,
  messages?: readonly MessageSnapshot[],
): { need: string } | { reject: "empty" | "deixis" | "nothing_without_gathered" | "verbatim" } {
  const text = raw.trim();
  if (!text) return { reject: "empty" };
  if (looksLikeNeedDeixis(text)) {
    if (gathered) return { need: gathered };
    return { reject: "deixis" };
  }
  if (looksLikeNothingToAdd(text) || looksLikeShortAffirmation(text)) {
    if (gathered) return { need: gathered };
    return { reject: "nothing_without_gathered" };
  }
  if (messages && interestCopiesLeadMessage(text, messages) && !allowNeedExtra(text, gathered, messages)) {
    return { reject: "verbatim" };
  }
  if (gathered) {
    const head = gathered.slice(0, Math.min(40, gathered.length));
    if (head && text.includes(head)) return { need: text };
    return { need: `${gathered}\n${text}` };
  }
  return { need: text };
}

/**
 * A later lead message may be appended onto a saved understanding ("גם בעברית").
 * The opener, or the only lead message, is not an extra.
 */
function allowNeedExtra(
  text: string,
  gathered: string,
  messages: readonly MessageSnapshot[],
): boolean {
  if (!gathered) return false;
  const leads = messages.filter((m) => m.role === "lead");
  if (leads.length < 2) return false;
  const latest = leads[leads.length - 1];
  if (!latest || compact(latest.text) !== compact(text)) return false;
  return leads.slice(0, -1).every((m) => compact(m.text) !== compact(text));
}
