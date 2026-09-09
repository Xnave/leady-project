import { describe, expect, it } from "vitest";
import { normalizeTalkOutcome } from "./interpreter";
import { buildTalkSystemPrompt, talkTransitionTargets } from "./prompt-builder";
import { ensureFlowRegistry } from "./capabilities";
import { flowForCatalog } from "./catalog";
import type { TalkStage, TurnContext } from "./types";
import { defaultHitlPolicy, defaultLeadSchema } from "./validate";

describe("normalizeTalkOutcome", () => {
  const stage = flowForCatalog("inbox").stages.talk as TalkStage;

  it("maps legacy book/escalate flags into effects + nextStage", () => {
    const booked = normalizeTalkOutcome({ reply: "ok", book: true }, stage);
    expect(booked.effects?.some((e) => e.type === "book_meeting")).toBe(true);

    const esc = normalizeTalkOutcome(
      { reply: "hand off", escalate: true, escalateReason: "manager" },
      stage,
    );
    expect(esc.effects?.some((e) => e.type === "request_human")).toBe(true);
    expect(esc.nextStage).toBe(stage.on_escalate);
  });
});

describe("PromptBuilder", () => {
  it("includes stage transition targets and booking capability lines", () => {
    ensureFlowRegistry();
    const flow = flowForCatalog("inbox");
    const stage = flow.stages.talk as TalkStage;
    expect(talkTransitionTargets(stage)).toEqual(["done", "escalate"]);

    const ctx: TurnContext = {
      tenantId: "t1",
      tenant: {
        name: "Demo",
        phone: "",
        intro: "Hello from Demo.",
        chatLanguage: "en",
        venueHours: "9-5",
        venueAddress: "1 Main",
      },
      agent: {
        id: "a1",
        tenantId: "t1",
        systemPrompt: "BASE",
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
      messages: [{ role: "lead", text: "Hi" }],
    };

    const prompt = buildTalkSystemPrompt(ctx, stage, {});
    expect(prompt).toMatch(/BASE/);
    expect(prompt).toMatch(/Allowed transition targets/);
    expect(prompt).toMatch(/Visit booking is NOT started|start_booking|Booking capability/i);
    expect(prompt).toMatch(/FIRST MESSAGE/);
    expect(prompt).not.toMatch(/Booking field gaps: time_preference/);
  });
});
