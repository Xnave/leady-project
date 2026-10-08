/**
 * Booking "need" / פרטי הפגישה helpers: early CRM interest, deixis, and soft "nothing to add".
 * Rails only — the talk LLM captures interest via tools in the same turn (no extra extract call).
 */

import type { LeadFields } from "./types";

/** CRM field: concrete context from early chat, before booking session `need` is filled. */
export function gatheredInterest(fields: LeadFields): string {
  return String(fields.interest ?? "").trim();
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
): { need: string } | { reject: "empty" | "deixis" | "nothing_without_gathered" } {
  const text = raw.trim();
  if (!text) return { reject: "empty" };
  if (looksLikeNeedDeixis(text)) {
    if (gathered) return { need: gathered };
    return { reject: "deixis" };
  }
  if (looksLikeNothingToAdd(text)) {
    if (gathered) return { need: gathered };
    return { reject: "nothing_without_gathered" };
  }
  if (gathered) {
    const head = gathered.slice(0, Math.min(40, gathered.length));
    if (head && text.includes(head)) return { need: text };
    return { need: `${gathered}\n${text}` };
  }
  return { need: text };
}
