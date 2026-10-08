import { describe, expect, it } from "vitest";
import { flowForCatalog } from "@/lib/flow/catalog";
import type { TurnContext } from "@/lib/flow/types";
import { defaultHitlPolicy, defaultLeadSchema } from "@/lib/flow/validate";
import { DEFAULT_PERSONA } from "./presets";
import { previewThrottle, runPersonaPreview } from "./preview";

const agent = {
  systemPrompt: "",
  knowledgeText: "We sell kitchens.",
  flow: flowForCatalog("inbox"),
  leadSchema: defaultLeadSchema,
  hitlPolicy: defaultHitlPolicy,
};
const tenant = { name: "Acme", phone: "", intro: "Hi from Acme", chatLanguage: "multi" as const };

describe("runPersonaPreview", () => {
  it("runs each sample through talk with persona on ctx and a prior agent message", async () => {
    const seen: TurnContext[] = [];
    const out = await runPersonaPreview(
      { persona: { ...DEFAULT_PERSONA, agentName: "Noa" }, lang: "en", agent, tenant },
      async (ctx) => {
        seen.push(ctx);
        return { reply: `R:${ctx.messages.at(-1)?.text}` };
      },
    );
    expect(out).toHaveLength(3);
    expect(out[0].reply).toMatch(/^R:/);
    expect(seen[0].agent.persona?.agentName).toBe("Noa");
    expect(seen[0].messages[0].role).toBe("agent");
    expect(seen[0].tenant?.chatLanguage).toBe("en");
  });
});

describe("previewThrottle", () => {
  it("allows one call per 4s per tenant", () => {
    expect(previewThrottle("t1", 1000)).toBe(true);
    expect(previewThrottle("t1", 2000)).toBe(false);
    expect(previewThrottle("t2", 2000)).toBe(true);
    expect(previewThrottle("t1", 5001)).toBe(true);
  });
});
