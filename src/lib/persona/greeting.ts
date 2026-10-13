import { copyFor, replyLang } from "@/lib/copy";
import { hasAgentReplied, looksLikeBareHello } from "@/lib/flow/intro";
import type { TurnContext } from "@/lib/flow/types";
import { personaOf } from "./context";
import { introIntroducesAgent } from "./prompt";

type GreetCtx = Pick<TurnContext, "tenant" | "agent" | "messages">;

const LEADING_HELLO = /^(שלום|היי|הי|אהלן|hello|hi|hey)[\s!,.]*/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The owner's intro, only when it is written in the customer's language. */
function ownerIntro(ctx: GreetCtx, lang: "en" | "he"): string {
  const intro = (ctx.tenant?.intro ?? "").trim();
  return /[֐-׿]/.test(intro) === (lang === "he") ? intro : "";
}

function personaLine(ctx: GreetCtx, lang: "en" | "he"): string {
  const p = personaOf(ctx);
  const business = ctx.tenant?.name?.trim() || (lang === "he" ? "העסק" : "the business");
  return copyFor(lang).chat.assistantIntro({ agentName: p.agentName, business, gender: p.gender });
}

/**
 * The one introduction of a conversation: the introducing sentence of the owner's opening
 * ("היי! אני בקי, העוזרת הווירטואלית של Taxtica.") or, if it doesn't introduce anyone, the persona line.
 */
export function openingLine(ctx: GreetCtx, lang: "en" | "he"): string {
  const intro = ownerIntro(ctx, lang);
  if (intro && introIntroducesAgent(intro)) {
    const parts = sentences(intro);
    const at = parts.findIndex((s) => introIntroducesAgent(s));
    return parts.slice(0, at + 1).join(" ");
  }
  return personaLine(ctx, lang);
}

/**
 * Fixed reply to a bare first "hi", with no LLM call. An owner opening that introduces the agent is
 * sent as written; otherwise the persona line, then the intro without its hello and without sentences
 * that only name the business again, then a question if there is none.
 */
export function personaGreeting(ctx: GreetCtx, lang: "en" | "he"): string {
  const intro = ownerIntro(ctx, lang);
  if (intro && introIntroducesAgent(intro)) return intro;
  const business = ctx.tenant?.name?.trim() ?? "";
  const rest = sentences(intro.replace(LEADING_HELLO, "")).filter((s) => !business || !s.includes(business));
  const hasQuestion = rest.some((s) => s.includes("?"));
  return [personaLine(ctx, lang), ...rest, hasQuestion ? "" : copyFor(lang).chat.askHowToHelp]
    .filter(Boolean)
    .join(" ");
}

/** A bare first "hi" gets the fixed greeting; anything else goes to the LLM. */
export function greetingOnlyReply(ctx: GreetCtx): string | undefined {
  if (hasAgentReplied(ctx as TurnContext)) return undefined;
  const last = [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
  if (!looksLikeBareHello(last)) return undefined;
  return personaGreeting(ctx, replyLang(ctx as TurnContext, last));
}

/** On the first reply, code adds the single introduction so the model can't repeat or skip it. */
export function withFirstMessageIntro(ctx: GreetCtx, lang: "en" | "he", reply: string): string {
  const body = reply.trim();
  if (!body || hasAgentReplied(ctx as TurnContext)) return body;
  const line = openingLine(ctx, lang);
  if (body.startsWith(line)) return body;
  // The model was told not to greet; drop a hello it added anyway, since the line already greets.
  return `${line} ${body.replace(LEADING_HELLO, "").trim() || body}`;
}
