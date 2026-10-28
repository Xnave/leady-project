import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA } from "@/lib/persona/presets";
import { bookingInstance } from "./booking-config";
import { normalizeTalkOutcome } from "./interpreter";
import { buildNudgeSystemPrompt, buildTalkSystemPrompt, talkTransitionTargets } from "./prompt-builder";
import { ensureFlowRegistry } from "./capabilities";
import { flowForCapabilities, flowForCatalog } from "./catalog";
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
    const s = buildNudgeSystemPrompt(ctx, talkStage(ctx), "");
    expect(s).toMatch(/1–2 short sentences/);
    expect(s).toMatch(/Do NOT say a visit or meeting was saved/);
    expect(s).toMatch(/Do NOT offer a calendar link, a callback, or a phone number, and do not attach a link/);
    expect(s).toMatch(/re-ask the open question/);
  });

  it("boundaries always open with BOUNDARIES and allow one question", () => {
    const ctx = makeCtx({});
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    expect(s).toMatch(/BOUNDARIES \(always apply/);
    expect(s).toMatch(/ask at most one clarifying question/);
    expect(s).toMatch(/invent a phone number, a callback, or a calendar link/);
    expect(s).toMatch(/only when that exact string is in knowledge/);
    expect(s).not.toMatch(/offer the public phone from context/);
  });

  it("next-step rule lives in the base talk instructions, not the persona", () => {
    const ctx = makeCtx({});
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    expect(s).toMatch(/one clear next step/);
    expect(s.indexOf("one clear next step")).toBeGreaterThan(s.indexOf("CONVERSATION CRAFT"));
  });

  it("later replies don't greet again", () => {
    const ctx = makeCtx({});
    expect(buildTalkSystemPrompt(ctx, talkStage(ctx))).toMatch(/already greeted/);
  });

  it("passive stance suggests a meeting only when relevant", () => {
    const ctx = makeCtx({});
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    expect(s).toMatch(/Offer a meeting at most once/);
    expect(s).not.toMatch(/Suggest a meeting at most once/);
    expect(s.indexOf("Offer a meeting at most once")).toBeGreaterThan(s.indexOf("CONVERSATION CRAFT"));
    expect(s.split("Offer a meeting at most once").length - 1).toBe(1);
    expect(s.split("If the knowledge file tells you what to reply").length - 1).toBe(1);
  });

  it("knowledge instructions outrank a capability next step", () => {
    const ctx = makeCtx({});
    const s = buildTalkSystemPrompt(ctx, talkStage(ctx));
    const peers = s.indexOf("Enabled capabilities are available workflows");
    const boundaries = s.indexOf("BOUNDARIES (always");
    expect(peers).toBeGreaterThan(s.indexOf("CONVERSATION CRAFT"));
    expect(peers).toBeLessThan(boundaries);
    expect(s).toMatch(/do not override a knowledge instruction/);
    expect(s).toMatch(/Do not replace that instruction with another capability's flow/);
    expect(s).toMatch(/Do not treat booking as the default next step/);
    expect(s).not.toMatch(/meeting\/visit\/demo\/call/);
  });

  it("proactive stance may invite a meeting once", () => {
    const ctx = makeCtx({});
    const flow = flowForCapabilities({ capabilities: ["booking"], bookingStance: "proactive" });
    ctx.agent.flow = flow;
    const s = buildTalkSystemPrompt(ctx, flow.stages.talk as TalkStage);
    expect(s).toMatch(/Suggest a meeting at most once/);
    expect(s.indexOf("Suggest a meeting at most once")).toBeGreaterThan(s.indexOf("CONVERSATION CRAFT"));
    expect(s.split("Suggest a meeting at most once").length - 1).toBe(1);
    expect(s.split("If the knowledge file tells you what to reply").length - 1).toBe(1);
    expect(s).not.toMatch(/you may invite them once, gently, to schedule/);
  });

  it("legacy book catalog with no stored stance stays proactive", () => {
    const flow = flowForCatalog("book");
    const stage = flow.stages.talk as TalkStage;
    delete stage.bookingStance;
    const ctx = makeCtx({ catalogId: "book", flow });
    const s = buildTalkSystemPrompt(ctx, stage);
    expect(s).toMatch(/Suggest a meeting at most once/);
    expect(s).not.toMatch(/Offer a meeting at most once/);
    expect(s.split("Suggest a meeting at most once").length - 1).toBe(1);
    expect(s.split("If the knowledge file tells you what to reply").length - 1).toBe(1);
  });
});

describe("first message", () => {
  function firstCtx(): TurnContext {
    ensureFlowRegistry();
    const flow = flowForCatalog("inbox");
    return {
      tenantId: "t1",
      tenant: { name: "Demo", phone: "", intro: "שלום, אני נועה מדמו. במה אפשר לעזור?", chatLanguage: "multi" },
      agent: {
        id: "a1", tenantId: "t1", systemPrompt: "", knowledgeText: "", flow, flowVersion: 1,
        leadSchema: defaultLeadSchema, hitlPolicy: defaultHitlPolicy, persona: DEFAULT_PERSONA,
      },
      conversation: { id: "c1", status: "open", flowState: "talk", flowVersion: 1, nudgeCountByStage: {} },
      lead: { id: "l1", externalUserId: "u1", fields: {} },
      messages: [{ role: "lead", text: "כמה עולה מטבח?" }],
    } as TurnContext;
  }
  it("starts from the owner's opening, answers first, no 'how can I help' after a real question", () => {
    const ctx = firstCtx();
    const s = buildTalkSystemPrompt(ctx, ctx.agent.flow.stages.talk as TalkStage);
    expect(s).toMatch(/FIRST MESSAGE:[^\n]*«שלום, אני נועה מדמו\.»[^\n]*added in front of your reply/);
    expect(s).not.toMatch(/FIRST MESSAGE:[^\n]*במה אפשר לעזור/);
    expect(s).toMatch(/do not ask how you can help/i);
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
