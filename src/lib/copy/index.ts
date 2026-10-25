import type { PersonaGender } from "@/lib/persona/types";
import { chat as chatEn, prompts as promptsEn } from "./en";
import { chat as chatHe, prompts as promptsHe } from "./he";
import type { BookingVars } from "./types";
import type { ChatLanguage } from "@/lib/flow/locale";
import { stickyReplyLanguage } from "@/lib/flow/locale";
import type { TurnContext } from "@/lib/flow/types";
import { formatPhoneDisplay } from "@/lib/leads";

export type { BookingVars } from "./types";
export { chat as enChat, prompts as enPrompts } from "./en";
export { chat as heChat, prompts as hePrompts } from "./he";

// Hebrew strings where the agent refers to itself get one entry per persona gender.
// The base he.ts text speaks as the business ("we") for callers without a persona;
// customer-directed text stays gender-neutral.
const HE_SELF: Record<PersonaGender, Partial<typeof chatHe>> = {
  female: { savingVisit: "קולטת את ההזמנה במערכת." },
  male: { savingVisit: "קולט את ההזמנה במערכת." },
};

export function copyFor(lang: "en" | "he", opts?: { gender?: PersonaGender }) {
  if (lang !== "he") return { chat: chatEn, prompts: promptsEn };
  const over = opts?.gender ? HE_SELF[opts.gender] : undefined;
  return { chat: over ? { ...chatHe, ...over } : chatHe, prompts: promptsHe };
}

export function replyLang(ctx: TurnContext, lastCustomer = ""): "en" | "he" {
  const policy = ctx.tenant?.chatLanguage;
  if (policy === "he" || policy === "en") return policy;
  const leads = ctx.messages
    .filter((message) => message.role === "lead")
    .map((message) => message.text);
  if (lastCustomer && leads[leads.length - 1] !== lastCustomer) leads.push(lastCustomer);
  return stickyReplyLanguage(ctx.conversation.replyLanguage, leads);
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

export function bookingVars(
  input: Partial<BookingVars> & { slot: string } & { alt_slot?: string },
): BookingVars & { alt_slot: string } {
  const need = input.need ?? "";
  const kind = input.kind ?? "visit";
  const details =
    input.details?.trim() ||
    [kind && kind !== "visit" ? kind : "", need].filter(Boolean).join(" · ") ||
    need ||
    kind;
  const rawPhone = input.phone ?? "";
  return {
    slot: input.slot,
    date: input.date ?? input.slot,
    time: input.time ?? "",
    weekday: input.weekday ?? "",
    address: input.address ?? "",
    hours: input.hours ?? "",
    name: input.name ?? "",
    phone: formatPhoneDisplay(rawPhone) || rawPhone,
    email: input.email ?? "",
    need,
    kind,
    details,
    business: input.business?.trim() || "",
    alt_slot: input.alt_slot ?? "",
  };
}

export function renderBookingMessage(
  template: string | undefined | null,
  fallback: string,
  vars: Record<string, string>,
): string {
  const source = template?.trim() || fallback;
  return fillTemplate(source, vars);
}

export function appendStaffNote(text: string, note: string | undefined, prefix: string): string {
  const trimmed = note?.trim();
  if (!trimmed) return text;
  return `${text}\n${prefix} ${trimmed}`;
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
