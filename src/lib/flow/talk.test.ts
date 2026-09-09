import { describe, expect, it } from "vitest";
import { degradeTalk } from "./llm";
import { flowForCatalog } from "./catalog";
import type { TalkStage, TurnContext } from "./types";
import { defaultLeadSchema, defaultHitlPolicy } from "./validate";

function talkCtx(text: string, extra?: Partial<TurnContext>): TurnContext {
  const flow = flowForCatalog("inbox");
  return {
    tenantId: "t1",
    tenant: {
      name: "Demo Co",
      phone: "",
      intro: "We help you book a visit.",
      chatLanguage: "en",
      venueHours: "Sun–Thu 09:00–19:00",
      venueAddress: "1 Main St",
    },
    agent: {
      id: "a1",
      tenantId: "t1",
      catalogId: "inbox",
      systemPrompt: "",
      knowledgeText: "We sell widgets.",
      flow,
      flowVersion: 1,
      leadSchema: defaultLeadSchema,
      hitlPolicy: defaultHitlPolicy,
    },
    conversation: {
      id: "c1",
      status: "open",
      flowState: "talk",
      flowVersion: 1,
      nudgeCountByStage: {},
    },
    lead: { id: "l1", externalUserId: "+1", fields: {} },
    messages: [{ role: "lead", text }],
    ...extra,
  };
}

describe("degradeTalk", () => {
  it("returns intro on first turn when LLM is down", () => {
    const ctx = talkCtx("Hello");
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = degradeTalk(ctx, stage);
    expect(out.reply).toMatch(/book a visit|Demo Co/i);
    expect(out.effects).toBeUndefined();
  });

  it("does not invent booking — holds and escalates when LLM is down", () => {
    const ctx = talkCtx("please book Thursday", {
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "We help you book a visit." },
        { role: "lead", text: "please book Thursday" },
      ],
      lead: {
        id: "l1",
        externalUserId: "demo-abc",
        fields: {
          name: "Nave",
          time_preference: "Thursday 18:00",
          need: "demo",
          booking_confirm: "confirmed",
        },
      },
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = degradeTalk(ctx, stage);
    expect(out.book).toBeUndefined();
    expect(out.effects?.some((e) => e.type === "request_human")).toBe(true);
    expect(out.nextStage).toBe(stage.on_escalate);
  });
});
