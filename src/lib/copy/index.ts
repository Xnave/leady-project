import { chat as chatEn, prompts as promptsEn } from "./en";
import { chat as chatHe, prompts as promptsHe } from "./he";
import type { BookingVars } from "./types";
import type { ChatLanguage } from "@/lib/flow/locale";
import { resolveReplyLanguage } from "@/lib/flow/locale";
import type { TurnContext } from "@/lib/flow/types";

export type { BookingVars } from "./types";
export { chat as enChat, prompts as enPrompts } from "./en";
export { chat as heChat, prompts as hePrompts } from "./he";

export function copyFor(lang: "en" | "he") {
  return lang === "he" ? { chat: chatHe, prompts: promptsHe } : { chat: chatEn, prompts: promptsEn };
}

export function replyLang(ctx: TurnContext, lastCustomer = ""): "en" | "he" {
  return resolveReplyLanguage(ctx.tenant?.chatLanguage, lastCustomer);
}

export function languageSystemRule(policy: ChatLanguage | undefined): string {
  if (policy === "he") return promptsHe.languageRule;
  if (policy === "en") return promptsEn.languageRule;
  return promptsEn.languageRuleMatch;
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  const filled = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
  return filled
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !/:\s*$/.test(line))
    .join("\n");
}

export function bookingVars(input: Partial<BookingVars> & { slot: string }): BookingVars {
  const need = input.need ?? "";
  const kind = input.kind ?? "visit";
  const details =
    input.details?.trim() ||
    [kind && kind !== "visit" ? kind : "", need].filter(Boolean).join(" · ") ||
    need ||
    kind;
  return {
    slot: input.slot,
    date: input.date ?? input.slot,
    time: input.time ?? "",
    address: input.address ?? "",
    hours: input.hours ?? "",
    name: input.name ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    need,
    kind,
    details,
  };
}

export function renderBookingMessage(
  template: string | undefined | null,
  fallback: string,
  vars: BookingVars,
): string {
  const source = template?.trim() || fallback;
  return fillTemplate(source, vars);
}

export function introGreeting(
  ctx: TurnContext,
  opts?: { askHowCanIHelp?: boolean; lastCustomer?: string },
): string {
  const last = opts?.lastCustomer ?? "";
  const lang = replyLang(ctx, last);
  const { chat } = copyFor(lang);
  const name = ctx.tenant?.name?.trim() || chat.fallbackTeamName;
  const fromPrompt = ctx.agent.systemPrompt
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !line.startsWith("You represent") &&
        !line.startsWith("Public phone") &&
        !line.startsWith("Always reply") &&
        !line.startsWith("Reply in"),
    );
  const intro = (ctx.tenant?.intro?.trim() || fromPrompt || "").replace(/\s+/g, " ");
  const ask = opts?.askHowCanIHelp !== false;

  if (!intro) return ask ? chat.helloHelp(name) : chat.hello(name);
  if (chat.howCanIHelpRe.test(intro)) return intro;
  if (lang === "he") {
    if (!ask) return chat.greetWithIntro(name, intro, false);
    return `${intro.replace(/\.?$/, ".")} ${chat.howCanIHelp}`;
  }
  return chat.greetWithIntro(name, intro, ask);
}

export function cannedFallbackIntro(ctx: TurnContext): string {
  const intro = ctx.tenant?.intro?.trim();
  if (intro) return intro;
  const lang = replyLang(ctx);
  const name = ctx.tenant?.name?.trim();
  if (name) return copyFor(lang).chat.hello(name);
  return lang === "he" ? "שלום." : "Hello.";
}
