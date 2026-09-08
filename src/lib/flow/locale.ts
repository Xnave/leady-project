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
