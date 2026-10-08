import { legacyPromptPipeline } from "@/lib/flow/prompt-builder";
import type { TurnContext } from "@/lib/flow/types";
import { personaOf } from "./context";
import { identitySection, personaSection, voiceCraftSection } from "./prompt";

/** Identity + persona + craft for single-shot LLM calls outside the talk prompt. */
export function voicePreamble(
  ctx: Pick<TurnContext, "tenant" | "agent" | "channel">,
  lang: "en" | "he",
  opts?: { knowledgeGapLine?: boolean },
): string {
  if (legacyPromptPipeline()) return "";
  const p = personaOf(ctx);
  return [
    identitySection({
      business: ctx.tenant?.name?.trim() || "this business",
      agentName: p.agentName,
      channel: ctx.channel?.provider ?? "chat",
    }),
    personaSection(p, lang),
    voiceCraftSection(p, opts),
  ].join("\n");
}

/** FAQ answers keep their UNRESOLVED contract: style above, the escalation rule restated last. */
export function faqSystemPrompt(
  ctx: Pick<TurnContext, "tenant" | "agent" | "channel">,
  lang: "en" | "he",
  faqBody: string,
): string {
  const preamble = voicePreamble(ctx, lang, { knowledgeGapLine: false });
  if (!preamble) return faqBody;
  return [
    preamble,
    faqBody,
    "These instructions override the style guidance above: if the knowledge does not answer the question, output exactly UNRESOLVED and nothing else.",
  ].join("\n");
}
