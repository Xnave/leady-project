import { talkTurn } from "@/lib/flow/llm";
import type { AgentSnapshot, TalkOutcome, TalkStage, TenantSnapshot, TurnContext } from "@/lib/flow/types";
import { PREVIEW_SAMPLES, type SampleId } from "./samples";
import type { Persona } from "./types";

export type AgentForPreview = Pick<
  AgentSnapshot,
  "systemPrompt" | "knowledgeText" | "flow" | "leadSchema" | "hitlPolicy"
>;
type TalkFn = (ctx: TurnContext, stage: TalkStage) => Promise<Pick<TalkOutcome, "reply" | "effects">>;

/** The LLM failed and talk fell back to a canned hand-off — not the persona's voice. */
export class PreviewUnavailableError extends Error {
  constructor() {
    super("preview unavailable: LLM call failed");
    this.name = "PreviewUnavailableError";
  }
}

function isLlmDegrade(out: Pick<TalkOutcome, "effects">): boolean {
  return Boolean(
    out.effects?.some((e) => e.type === "request_human" && e.args?.reason === "llm_unavailable"),
  );
}

const PREVIEW_GAP_MS = 4000;
const lastCall = new Map<string, number>();

/** true = allowed. One live preview per tenant every 4s (each call is 3 LLM turns). */
export function previewThrottle(tenantId: string, now = Date.now()): boolean {
  const prev = lastCall.get(tenantId);
  if (prev !== undefined && now - prev < PREVIEW_GAP_MS) return false;
  lastCall.set(tenantId, now);
  return true;
}

/** Runs the real talk turn on fixed sample messages. No DB, no effects — talk tools only collect output. */
export async function runPersonaPreview(
  input: { persona: Persona; lang: "en" | "he"; agent: AgentForPreview; tenant: TenantSnapshot },
  talk: TalkFn = talkTurn,
): Promise<{ id: SampleId; customer: string; reply: string; handoff: boolean }[]> {
  const entry = Object.entries(input.agent.flow.stages).find(([, s]) => s.type === "talk");
  if (!entry) throw new Error("agent has no talk stage");
  const [stageKey, stage] = entry as [string, TalkStage];
  return Promise.all(
    PREVIEW_SAMPLES[input.lang].map(async (sample) => {
      const ctx: TurnContext = {
        tenantId: "preview",
        tenant: { ...input.tenant, chatLanguage: input.lang },
        agent: { id: "preview", tenantId: "preview", flowVersion: 1, ...input.agent, persona: input.persona },
        conversation: {
          id: "preview",
          status: "open",
          flowState: stageKey,
          flowVersion: 1,
          nudgeCountByStage: {},
        },
        lead: { id: "preview", externalUserId: "preview-user", fields: {} },
        // A prior agent greeting so the canned intro doesn't replace the reply.
        messages: [
          { role: "agent", text: input.tenant.intro || "Hi!" },
          { role: "lead", text: sample.customer },
        ],
        channel: { provider: "whatsapp" },
      };
      const out = await talk(ctx, stage);
      if (isLlmDegrade(out)) throw new PreviewUnavailableError();
      const reply = out.reply?.trim() ?? "";
      // No text = the agent handed off (or only transitioned); show that, not an empty bubble.
      return { id: sample.id, customer: sample.customer, reply, handoff: !reply };
    }),
  );
}
