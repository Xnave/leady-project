import type { TurnContext } from "@/lib/flow/types";
import { personaOf } from "./context";
import { identitySection, personaSection, voiceCraftSection } from "./prompt";

/**
 * Identity + persona + craft for the single-shot LLM calls that don't go through the talk
 * PromptBuilder (collect-stage field questions, FAQ answers), so every reply sounds the same.
 */
export function voicePreamble(ctx: Pick<TurnContext, "tenant" | "agent" | "channel">, lang: "en" | "he"): string {
  const p = personaOf(ctx);
  return [
    identitySection({
      business: ctx.tenant?.name?.trim() || "this business",
      agentName: p.agentName,
      channel: ctx.channel?.provider ?? "chat",
    }),
    personaSection(p, lang),
    voiceCraftSection(),
  ].join("\n");
}

/** FAQ answers keep their UNRESOLVED contract: style first, the contract restated last so it wins. */
export function faqSystemPrompt(
  ctx: Pick<TurnContext, "tenant" | "agent" | "channel">,
  lang: "en" | "he",
  faqBody: string,
): string {
  return [
    voicePreamble(ctx, lang),
    faqBody,
    "These instructions override the style guidance above: if the knowledge does not answer the question, output exactly UNRESOLVED and nothing else.",
  ].join("\n");
}
