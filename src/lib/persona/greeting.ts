import { copyFor, replyLang } from "@/lib/copy";
import { hasAgentReplied, looksLikeBareHello } from "@/lib/flow/intro";
import type { TurnContext } from "@/lib/flow/types";
import { personaOf } from "./context";
import { introIntroducesAgent } from "./prompt";

type GreetCtx = Pick<TurnContext, "tenant" | "agent" | "messages">;

const LEADING_HELLO = /^(שלום|היי|הי|אהלן|hello|hi|hey)[\s!,.]*/i;

/**
 * Fixed opening with no LLM call. An owner intro that already introduces the agent is used exactly
 * as written; otherwise: "היי! אני עדי, העוזרת הדיגיטלית של X." + the intro (its hello dropped) + a
 * question if it has none.
 */
export function personaGreeting(ctx: GreetCtx, lang: "en" | "he"): string {
  const raw = (ctx.tenant?.intro ?? "").trim();
  if (raw && introIntroducesAgent(raw)) return raw;
  const p = personaOf(ctx);
  const chat = copyFor(lang).chat;
  const business = ctx.tenant?.name?.trim() || (lang === "he" ? "העסק" : "the business");
  const intro = raw.replace(LEADING_HELLO, "").trim();
  return [
    chat.assistantIntro({ agentName: p.agentName, business, gender: p.gender }),
    intro,
    intro.includes("?") ? "" : chat.askHowToHelp,
  ]
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
