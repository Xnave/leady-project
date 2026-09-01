import { describe, expect, it } from "vitest";
import { heuristicTalk } from "./llm";
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

describe("heuristicTalk", () => {
  it("greets with the intro on hello", () => {
    const ctx = talkCtx("Hello");
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toBe("We help you book a visit.");
  });

  it("does not run a vertical-specific script after the intro", () => {
    const ctx = talkCtx("I want to book", {
      messages: [
        { role: "lead", text: "Hello" },
        { role: "agent", text: "We help you book a visit." },
        { role: "lead", text: "I want to book" },
      ],
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.book).toBeUndefined();
    expect(out.reply).toBe("Got it. Tell me a bit more.");
  });

  it("books when required fields are already on this lead", () => {
    const ctx = talkCtx("please save that", {
      channel: { provider: "whatsapp", customerPhone: "+972501234567" },
      lead: {
        id: "l1",
        externalUserId: "+972501234567",
        fields: {
          name: "Nave",
          time_preference: "Thursday 18:00",
          need: "demo",
          phone: "+972501234567",
        },
      },
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "We help you book a visit." },
        { role: "lead", text: "please save that" },
      ],
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.book).toBe(true);
    expect(out.fields?.phone).toBe("+972501234567");
  });
});
