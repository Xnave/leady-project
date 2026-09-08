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
  it("greets with an empty body on a bare hello so the interpreter can send the intro", () => {
    const ctx = talkCtx("Hello");
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toBe("");
  });

  it("adds tell-me-more on a first message with substance", () => {
    const ctx = talkCtx("I want a quote for a kitchen");
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toBe("Got it. Tell me a bit more.");
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

  it("does not book a demo lead when phone is still required and missing", () => {
    const ctx = talkCtx("please save that", {
      channel: { provider: "whatsapp" },
      lead: {
        id: "l1",
        externalUserId: "demo-abc",
        fields: {
          name: "Nave",
          time_preference: "Thursday 18:00",
          need: "demo",
        },
      },
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "We help you book a visit." },
        { role: "lead", text: "please save that" },
      ],
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    stage.required_for_book = ["time_preference", "name", "need", "phone"];
    const out = heuristicTalk(ctx, stage);
    expect(out.book).toBeUndefined();
  });

  it("books when required fields including phone are already on this lead", () => {
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
  });

  it("saves deduced phone when the customer confirms with yes", () => {
    const ctx = talkCtx("כן", {
      channel: { provider: "whatsapp", customerPhone: "+972501234567" },
      lead: {
        id: "l1",
        externalUserId: "+972501234567",
        fields: {
          name: "Nave",
          time_preference: "Thursday 18:00",
          need: "demo",
        },
      },
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "I'll use +972501234567 — ok?" },
        { role: "lead", text: "כן" },
      ],
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    stage.required_for_book = ["time_preference", "name", "need", "phone"];
    const out = heuristicTalk(ctx, stage);
    expect(out.fields?.phone).toBe("+972501234567");
    expect(out.book).toBe(true);
  });
});
