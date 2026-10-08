import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PERSONA } from "@/lib/persona/presets";
import { bookingInstance } from "./booking-config";
import { normalizeTalkOutcome } from "./interpreter";
import { buildNudgeSystemPrompt, buildTalkSystemPrompt, talkTransitionTargets } from "./prompt-builder";
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
        capabilityInstances: [
          bookingInstance({ venueHours: "9-5", venueAddress: "1 Main" }),
        ],
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
    expect(prompt).toMatch(/Today is /);
    expect(prompt).toMatch(/Asia\/Jerusalem/);
    expect(prompt).not.toMatch(/Booking field gaps: time_preference/);
  });
});

describe("persona prompt order", () => {
  function makeCtx(agentOverrides: Partial<TurnContext["agent"]>): TurnContext {
    ensureFlowRegistry();
    const flow = flowForCatalog("inbox");
    return {
      tenantId: "t1",
      tenant: { name: "Demo", phone: "", intro: "Hello from Demo.", chatLanguage: "en" },
      agent: {
        id: "a1",
        tenantId: "t1",
        systemPrompt:
          "Reply in the customer's language.\nYou represent Demo as a front-desk assistant only - not a professional.",
        knowledgeText: "We sell widgets.",
        flow,
        flowVersion: 1,
        leadSchema: defaultLeadSchema,
        hitlPolicy: defaultHitlPolicy,
        persona: DEFAULT_PERSONA,
        ...agentOverrides,
      },
      conversation: { id: "c1", status: "open", flowState: "talk", flowVersion: 1, nudgeCountByStage: {} },
      lead: { id: "l1", externalUserId: "u1", fields: {} },
      messages: [
        { role: "agent", text: "Hello from Demo." },
        { role: "lead", text: "how much?" },
      ],
    } as TurnContext;
  }
  const talkStage = (ctx: TurnContext) => ctx.agent.flow.stages.talk as TalkStage;

  afterEach(() => {
    delete process.env.PROMPT_PIPELINE;
  });

  it("identity → persona → craft → boundaries → closing", () => {
    const ctx = makeCtx({ persona: { ...DEFAULT_PERSONA, agentName: "Noa" } });
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    const at = (m: string) => s.indexOf(m);
    expect(at("IDENTITY:")).toBeGreaterThanOrEqual(0);
    expect(at("IDENTITY:")).toBeLessThan(at("PERSONA"));
    expect(at("PERSONA")).toBeLessThan(at("CONVERSATION CRAFT"));
    expect(at("CONVERSATION CRAFT")).toBeLessThan(at("BOUNDARIES (always"));
    expect(at("BOUNDARIES (always")).toBeLessThan(at("Prefer one reply call"));
  });

  it("keeps every MUST NOT rule and drops the ROLE/front-desk framing", () => {
    const ctx = makeCtx({});
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    expect(s).toMatch(/MUST NOT: jump to day\/time questions/);
    expect(s).not.toMatch(/ROLE: Front-desk chat assistant/);
    expect(s).not.toMatch(/You represent .* front-desk assistant only/);
  });

  it("owner rules come before boundaries", () => {
    const ctx = makeCtx({ persona: { ...DEFAULT_PERSONA, rules: ["Always mention free parking"] } });
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    expect(s.indexOf("free parking")).toBeLessThan(s.indexOf("BOUNDARIES (always"));
  });

  it("missing persona falls back to default", () => {
    const ctx = makeCtx({ persona: undefined });
    expect(buildTalkSystemPrompt(ctx, talkStage(ctx))).toMatch(/Warm and friendly/);
  });

  it("nudge prompt has persona too", () => {
    const ctx = makeCtx({ persona: { ...DEFAULT_PERSONA, length: "short" } });
    expect(buildNudgeSystemPrompt(ctx, talkStage(ctx), "")).toMatch(/1–2 short sentences/);
  });

  it("PROMPT_PIPELINE=legacy reproduces the old prompt", () => {
    process.env.PROMPT_PIPELINE = "legacy";
    const ctx = makeCtx({});
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    expect(s).toMatch(/ROLE: Front-desk chat assistant/);
    expect(s).not.toMatch(/PERSONA/);
  });
});

describe("question style vs boundaries", () => {
  it("bundled persona is not contradicted by a one-question boundary", () => {
    ensureFlowRegistry();
    const flow = flowForCatalog("inbox");
    const ctx = {
      tenantId: "t1",
      tenant: { name: "Demo", phone: "", intro: "Hi", chatLanguage: "en" },
      agent: {
        id: "a1", tenantId: "t1", systemPrompt: "", knowledgeText: "", flow, flowVersion: 1,
        leadSchema: defaultLeadSchema, hitlPolicy: defaultHitlPolicy,
        persona: { ...DEFAULT_PERSONA, questionStyle: "bundled" },
      },
      conversation: { id: "c1", status: "open", flowState: "talk", flowVersion: 1, nudgeCountByStage: {} },
      lead: { id: "l1", externalUserId: "u1", fields: {} },
      messages: [{ role: "agent", text: "Hi" }, { role: "lead", text: "hello" }],
    } as TurnContext;
    const s = buildTalkSystemPrompt(ctx, flow.stages.talk as TalkStage);
    expect(s).not.toMatch(/ask at most one clarifying question/);
    expect(s).toMatch(/up to 3 related clarifying questions/);
  });
});

describe("first message", () => {
  function firstCtx(): TurnContext {
    ensureFlowRegistry();
    const flow = flowForCatalog("inbox");
    return {
      tenantId: "t1",
      tenant: { name: "Demo", phone: "", intro: "שלום, הגעתם לדמו. במה אפשר לעזור?", chatLanguage: "multi" },
      agent: {
        id: "a1", tenantId: "t1", systemPrompt: "", knowledgeText: "", flow, flowVersion: 1,
        leadSchema: defaultLeadSchema, hitlPolicy: defaultHitlPolicy, persona: DEFAULT_PERSONA,
      },
      conversation: { id: "c1", status: "open", flowState: "talk", flowVersion: 1, nudgeCountByStage: {} },
      lead: { id: "l1", externalUserId: "u1", fields: {} },
      messages: [{ role: "lead", text: "How much for a kitchen?" }],
    } as TurnContext;
  }
  afterEach(() => {
    delete process.env.PROMPT_PIPELINE;
  });

  it("uses the intro as inspiration, answers first, no 'how can I help' after a real question", () => {
    const ctx = firstCtx();
    const s = buildTalkSystemPrompt(ctx, ctx.agent.flow.stages.talk as TalkStage);
    expect(s).not.toMatch(/do not invent a different welcome/);
    expect(s).toMatch(/FIRST MESSAGE:[^\n]*customer's language/);
    expect(s).toMatch(/do not ask how you can help/i);
  });

  it("legacy pipeline keeps the verbatim-intro instruction", () => {
    process.env.PROMPT_PIPELINE = "legacy";
    const ctx = firstCtx();
    expect(buildTalkSystemPrompt(ctx, ctx.agent.flow.stages.talk as TalkStage)).toMatch(
      /do not invent a different welcome/,
    );
  });
});

describe("reply language", () => {
  it("states this turn's resolved reply language", () => {
    ensureFlowRegistry();
    const flow = flowForCatalog("inbox");
    const ctx = {
      tenantId: "t1",
      tenant: { name: "Demo", phone: "", intro: "שלום", chatLanguage: "multi" },
      agent: {
        id: "a1", tenantId: "t1", systemPrompt: "", knowledgeText: "ידע בעברית", flow, flowVersion: 1,
        leadSchema: defaultLeadSchema, hitlPolicy: defaultHitlPolicy, persona: DEFAULT_PERSONA,
      },
      conversation: { id: "c1", status: "open", flowState: "talk", flowVersion: 1, nudgeCountByStage: {} },
      lead: { id: "l1", externalUserId: "u1", fields: {} },
      messages: [{ role: "lead", text: "How much for a kitchen?" }],
    } as TurnContext;
    const s = buildTalkSystemPrompt(ctx, flow.stages.talk as TalkStage);
    expect(s).toMatch(/Write this reply in English/);
  });
});
