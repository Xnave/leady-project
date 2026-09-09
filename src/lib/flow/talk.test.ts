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
  it("returns empty body on first turn so the interpreter can send the intro", () => {
    const ctx = talkCtx("Hello");
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toBe("");
  });

  it("asks for the next booking field when required and missing", () => {
    const ctx = talkCtx("please save that", {
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "We help you book a visit." },
        { role: "lead", text: "please save that" },
      ],
      lead: {
        id: "l1",
        externalUserId: "demo-abc",
        fields: {
          name: "Nave",
          time_preference: "Thursday 18:00",
          need: "demo",
        },
      },
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    stage.required_for_book = ["time_preference", "name", "need", "phone"];
    const out = heuristicTalk(ctx, stage);
    expect(out.book).toBeUndefined();
    expect(out.reply).toMatch(/phone/i);
  });

  it("saves the prior time answer then asks the next gap", () => {
    const timeAsk = "מתי נוח לך? יום ושעה.";
    const ctx = talkCtx("ביום חמישי ב12:00", {
      tenant: {
        name: "Demo Co",
        phone: "",
        intro: "We help you book a visit.",
        chatLanguage: "he",
        venueHours: "",
        venueAddress: "1 Main St",
      },
      messages: [
        { role: "lead", text: "דמו" },
        { role: "agent", text: "כדי לקלוט את ההזמנה במערכת - איך קוראים לך?" },
        { role: "lead", text: "נווה" },
        { role: "agent", text: timeAsk },
        { role: "lead", text: "ביום חמישי ב12:00" },
      ],
      lead: {
        id: "l1",
        externalUserId: "demo-abc",
        fields: { name: "נווה" },
      },
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    stage.required_for_book = ["time_preference", "name", "need"];
    const out = heuristicTalk(ctx, stage);
    expect(out.fields?.time_preference).toBe("ביום חמישי ב12:00");
    expect(out.reply).toMatch(/חשוב שנכסה|need|visit/i);
  });

  it("does not start booking collect on a FAQ turn with empty fields", () => {
    const ctx = talkCtx("Do you also handle phone inquiries?", {
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "We help you book a visit." },
        { role: "lead", text: "Do you also handle phone inquiries?" },
      ],
      lead: { id: "l1", externalUserId: "demo-abc", fields: {} },
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).not.toMatch(/name|phone|time|visit|book/i);
    expect(out.reply).toBe("Got it. Tell me a bit more.");
  });

  it("books when required fields and confirm are present", () => {
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
          booking_confirm: "confirmed",
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
});
