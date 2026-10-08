import { legacyPromptPipeline } from "@/lib/flow/prompt-builder";
import type { TurnContext } from "@/lib/flow/types";
import { personaOf } from "./context";
import { identitySection, personaSection, voiceCraftSection } from "./prompt";

/** Identity + persona + craft for single-shot LLM calls outside the talk prompt. */
export function voicePreamble(
  ctx: Pick<TurnContext, "tenant" | "agent" | "channel">,
  lang: "en" | "he",
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
    voiceCraftSection(p),
  ].join("\n");
}
