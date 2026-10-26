export type ChatLanguage = "multi" | "en" | "he";

export function isChatLanguage(value: string): value is ChatLanguage {
  return value === "multi" || value === "en" || value === "he";
}

export function looksHebrew(text: string): boolean {
  return /\p{Script=Hebrew}/u.test(text);
}

export function lastAgentText(messages: { role: string; text: string }[]): string {
  return [...messages].reverse().find((m) => m.role === "agent")?.text ?? "";
}

export function lastLeadMessage(messages: { role: string; text: string }[]): string {
  return [...messages].reverse().find((m) => m.role === "lead")?.text ?? "";
}

export function resolveReplyLanguage(
  policy: ChatLanguage | undefined,
  lastCustomerText: string,
): "en" | "he" {
  if (policy === "he") return "he";
  if (policy === "en") return "en";
  return looksHebrew(lastCustomerText) ? "he" : "en";
}

/** Hebrew letters, or Latin letters with no Hebrew. A phone or a clock is neither. */
export function explicitReplyLanguage(text: string): "en" | "he" | undefined {
  if (looksHebrew(text)) return "he";
  if (/[A-Za-z]/.test(text)) return "en";
  return undefined;
}

/**
 * Saved thread language. A saved value changes only from the latest lead text.
 * An empty save is seeded once from lead messages already in hand.
 */
export function stickyReplyLanguage(
  saved: string | undefined,
  leadTexts: readonly string[],
): "en" | "he" {
  const stored = saved === "he" || saved === "en" ? saved : undefined;
  if (stored) {
    const latest = leadTexts.length > 0 ? leadTexts[leadTexts.length - 1] : "";
    return explicitReplyLanguage(latest) ?? stored;
  }
  let current: "en" | "he" | undefined;
  for (const text of leadTexts) {
    const next = explicitReplyLanguage(text);
    if (next) current = next;
  }
  return current ?? "en";
}
