import { describe, expect, it } from "vitest";
import { previewFlow } from "./preview";
import { salesOrSupportFlow } from "./templates";
import { defaultFlow, defaultHitlPolicy, defaultLeadSchema } from "./validate";

describe("previewFlow", () => {
  it("walks quote → collect → book", async () => {
    const result = await previewFlow(
      {
        flow: salesOrSupportFlow,
        leadSchema: defaultLeadSchema,
        hitlPolicy: {
          ...defaultHitlPolicy,
          allowedFromStages: ["escalate"],
        },
        knowledgeText: "Filters reset with the side button.",
        systemPrompt: "",
      },
      ["Hi, I want a kitchen quote", "Full remodel. I'm Dana, dana@x.com"],
    );
    expect(result.errors).toEqual([]);
    expect(result.fields.email).toBe("dana@x.com");
    expect(result.actions).toContain("book_meeting");
    expect(result.path.at(-1)).toBe("done");
  });

  it("talk greets with intro and does not ask for a name first", async () => {
    const result = await previewFlow(
      {
        flow: defaultFlow(),
        leadSchema: defaultLeadSchema,
        hitlPolicy: defaultHitlPolicy,
        knowledgeText: "Filters reset with the side button.",
        systemPrompt: "",
        tenant: {
          name: "Demo Kitchen Co",
          phone: "",
          intro: "We design and install kitchens.",
          chatLanguage: "en",
        },
      },
      ["Hello"],
    );
    expect(result.errors).toEqual([]);
    expect(result.replies[0]).toBe("We design and install kitchens.");
    expect(result.replies[0]).not.toMatch(/your name/i);
    expect(result.fields.name).toBeUndefined();
    expect(result.path.at(-1)).toBe("talk");
  });
});
