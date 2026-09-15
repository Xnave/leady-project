import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TalkStage, TurnContext } from "./types";
import { defaultHitlPolicy, defaultLeadSchema } from "./validate";

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ai")>();
  return {
    ...mod,
    generateText: generateTextMock,
  };
});

vi.mock("./model", () => ({
  llmConfigured: () => true,
  chatModel: () => "mock-model",
}));

import { ensureFlowRegistry } from "./capabilities";
import {
  flowForCapabilities,
  flowForCatalog,
  resolveBookingStance,
} from "./catalog";
import { enforceBookingEffects } from "./interpreter";
import { talkTurn } from "./llm";
import { buildTalkSystemPrompt } from "./prompt-builder";
import {
  getCapability,
  resolveTalkCapabilities,
  sessionFieldKeysForStage,
} from "./registry";

function baseCtx(
  flow = flowForCapabilities({ capabilities: ["booking"], bookingStance: "passive" }),
  extra?: Partial<TurnContext>,
): TurnContext {
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
      systemPrompt: "SYSTEM BASE",
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
    lead: { id: "l1", externalUserId: "+15551212", fields: {} },
    messages: [{ role: "lead", text: "Hi, tell me about widgets" }],
    ...extra,
  };
}

function talkStage(flow = flowForCapabilities({ capabilities: ["booking"] })): TalkStage {
  return flow.stages.talk as TalkStage;
}

function toolNamesFromCapability(
  capId: string,
  ctx: TurnContext,
  stage: TalkStage,
  fields: Record<string, unknown> = {},
): string[] {
  ensureFlowRegistry();
  const cap = getCapability(capId);
  expect(cap?.tools).toBeTruthy();
  const tools = cap!.tools!({
    ctx: { ...ctx, lead: { ...ctx.lead, fields: { ...ctx.lead.fields, ...fields } } },
    stage,
    collected: { reply: "", fields: {}, effects: [] },
  });
  return Object.keys(tools).sort();
}

describe("flowForCapabilities settings", () => {
  it("builds faq-style flow with empty capabilities", () => {
    const flow = flowForCapabilities({ capabilities: [] });
    const stage = flow.stages.talk as TalkStage;
    expect(stage.capabilities).toEqual([]);
    expect(stage.allowBook).toBe(false);
    expect(stage.prompt).toMatch(/Do not collect booking|do not collect booking/i);
    expect(resolveTalkCapabilities(stage)).toEqual([]);
  });

  it("sets booking + passive stance (assist) vs proactive", () => {
    const passive = flowForCapabilities({
      capabilities: ["booking"],
      bookingStance: "passive",
    }).stages.talk as TalkStage;
    const proactive = flowForCapabilities({
      capabilities: ["booking"],
      bookingStance: "proactive",
    }).stages.talk as TalkStage;

    expect(passive.capabilities).toEqual(["booking"]);
    expect(passive.bookingStance).toBe("passive");
    expect(passive.allowBook).toBe(true);
    expect(passive.prompt).toMatch(/NOT a booking request|explicitly ask to schedule/i);

    expect(proactive.bookingStance).toBe("proactive");
    expect(proactive.prompt).toMatch(/book a visit when ready|confirm details before book_meeting/i);
  });

  it("migrates legacy catalog book → booking + proactive", () => {
    const stage = flowForCatalog("book").stages.talk as TalkStage;
    expect(stage.capabilities).toEqual(["booking"]);
    expect(stage.bookingStance).toBe("proactive");
    expect(resolveBookingStance({ catalogId: "book" })).toBe("proactive");
  });

  it("attaches multiple capabilities including stub packs", () => {
    ensureFlowRegistry();
    const stage = flowForCapabilities({
      capabilities: ["booking", "orders", "docs"],
    }).stages.talk as TalkStage;
    expect(resolveTalkCapabilities(stage)).toEqual(["booking", "orders", "docs"]);
    expect(sessionFieldKeysForStage(stage)).toEqual(
      expect.arrayContaining(["booking_flow", "order_draft", "docs_requested"]),
    );
  });
});

describe("system prompts by capability", () => {
  beforeEach(() => {
    ensureFlowRegistry();
  });

  it("includes booking idle / start_booking guidance when booking is on", () => {
    const flow = flowForCapabilities({ capabilities: ["booking"], bookingStance: "passive" });
    const stage = talkStage(flow);
    const prompt = buildTalkSystemPrompt(baseCtx(flow), stage, {});
    expect(prompt).toMatch(/SYSTEM BASE/);
    expect(prompt).toMatch(/Visit booking is NOT started|start_booking/i);
    expect(prompt).toMatch(/פרטי הפגישה|update_meeting_details|Meeting details/i);
    expect(prompt).not.toMatch(/Orders capability is enabled/);
  });

  it("omits booking tools guidance when capabilities are empty", () => {
    const flow = flowForCapabilities({ capabilities: [] });
    const stage = talkStage(flow);
    const prompt = buildTalkSystemPrompt(baseCtx(flow), stage, {});
    expect(prompt).toMatch(/Do not collect booking|do not collect booking/i);
    expect(prompt).not.toMatch(/Visit booking is NOT started/);
    expect(prompt).not.toMatch(/start_booking/);
    expect(prompt).not.toMatch(/update_meeting_details/);
  });

  it("includes orders and docs stub sections when those capabilities are enabled", () => {
    const flow = flowForCapabilities({ capabilities: ["orders", "docs"] });
    const stage = talkStage(flow);
    const prompt = buildTalkSystemPrompt(baseCtx(flow), stage, {});
    expect(prompt).toMatch(/Orders capability is enabled/);
    expect(prompt).toMatch(/Document collection capability is enabled/);
    expect(prompt).not.toMatch(/start_booking/);
  });

  it("uses proactive stage prompt text when bookingStance is proactive", () => {
    const flow = flowForCapabilities({
      capabilities: ["booking"],
      bookingStance: "proactive",
    });
    const stage = talkStage(flow);
    const prompt = buildTalkSystemPrompt(baseCtx(flow), stage, {});
    expect(prompt).toMatch(/book a visit when ready/i);
  });

  it("switches to in-progress booking lines when booking_flow is active", () => {
    const flow = flowForCapabilities({ capabilities: ["booking"] });
    const stage = talkStage(flow);
    const prompt = buildTalkSystemPrompt(baseCtx(flow), stage, {
      booking_flow: "active",
      time_preference: "",
    });
    expect(prompt).toMatch(/Visit booking is in progress/i);
    expect(prompt).toMatch(/confirm_details|book_meeting/i);
  });
});

describe("capability tools surface", () => {
  beforeEach(() => {
    ensureFlowRegistry();
  });

  it("exposes start_booking + update_meeting_details when booking idle", () => {
    const flow = flowForCapabilities({ capabilities: ["booking"] });
    const ctx = baseCtx(flow);
    const names = toolNamesFromCapability("booking", ctx, talkStage(flow));
    expect(names).toContain("start_booking");
    expect(names).toContain("update_meeting_details");
    expect(names).not.toContain("ask_field");
    expect(names).not.toContain("resolve_offered_slot");
  });

  it("exposes ask_field / book_meeting tools when booking collect is active", () => {
    const flow = flowForCapabilities({ capabilities: ["booking"] });
    const ctx = baseCtx(flow);
    const names = toolNamesFromCapability("booking", ctx, talkStage(flow), {
      booking_flow: "active",
    });
    expect(names).toEqual(
      expect.arrayContaining([
        "ask_field",
        "save_fields",
        "confirm_details",
        "book_meeting",
        "update_meeting_details",
      ]),
    );
    expect(names).not.toContain("start_booking");
  });

  it("exposes resolve_offered_slot when a staff slot offer is pending", () => {
    const flow = flowForCapabilities({ capabilities: ["booking"] });
    const ctx = baseCtx(flow);
    const names = toolNamesFromCapability("booking", ctx, talkStage(flow), {
      staff_slot_offer: {
        meetingId: "m1",
        slot: "Thursday 16:00",
        previousSlot: "Wednesday 10:00",
      },
    });
    expect(names).toContain("resolve_offered_slot");
    expect(names).toContain("update_meeting_details");
    expect(names).not.toContain("start_booking");
    expect(names).not.toContain("ask_field");
  });

  it("orders/docs packs have no tools yet (prompt-only stubs)", () => {
    ensureFlowRegistry();
    expect(getCapability("orders")?.tools).toBeUndefined();
    expect(getCapability("docs")?.tools).toBeUndefined();
  });
});

describe("enforceBookingEffects respects capabilities", () => {
  it("does not force book_meeting when booking capability is off", () => {
    const flow = flowForCapabilities({ capabilities: [] });
    const stage = talkStage(flow);
    const ctx = baseCtx(flow, {
      lead: {
        id: "l1",
        externalUserId: "+1",
        fields: {
          booking_flow: "active",
          booking_confirm: "confirmed",
          name: "Dana",
          time_preference: "Thu 18:00",
          need: "demo",
        },
      },
    });
    const out = enforceBookingEffects(ctx, stage, { reply: "ok" });
    expect(out.effects?.some((e) => e.type === "book_meeting")).toBeFalsy();
  });

  it("injects book_meeting when booking is on and confirm is complete", () => {
    const flow = flowForCapabilities({ capabilities: ["booking"] });
    const stage = talkStage(flow);
    const ctx = baseCtx(flow, {
      lead: {
        id: "l1",
        externalUserId: "+1",
        fields: {
          booking_flow: "active",
          booking_confirm: "confirmed",
          name: "Dana Cohen",
          name_collected_by_agent: "1",
          time_preference: "Thu 18:00",
          need: "demo",
        },
      },
    });
    const out = enforceBookingEffects(ctx, stage, { reply: "ok" });
    expect(out.effects?.some((e) => e.type === "book_meeting")).toBe(true);
  });
});

describe("talkTurn with mocked LLM", () => {
  beforeEach(() => {
    ensureFlowRegistry();
    generateTextMock.mockReset();
  });

  it("passes booking tools + booking system prompt when booking is enabled", async () => {
    let seenTools: string[] = [];
    let seenSystem = "";

    generateTextMock.mockImplementation(async (opts: {
      system: string;
      tools: Record<string, { execute?: (args: unknown) => Promise<unknown> }>;
    }) => {
      seenSystem = opts.system;
      seenTools = Object.keys(opts.tools).sort();
      await opts.tools.reply?.execute?.({ text: "Happy to help with widgets." });
      return { text: "" };
    });

    const flow = flowForCapabilities({ capabilities: ["booking"], bookingStance: "passive" });
    const ctx = baseCtx(flow);
    const out = await talkTurn(ctx, talkStage(flow));

    expect(out.reply).toBe("Happy to help with widgets.");
    expect(seenTools).toEqual(
      expect.arrayContaining([
        "reply",
        "set_intent",
        "transition",
        "start_booking",
        "update_meeting_details",
      ]),
    );
    expect(seenTools).not.toContain("ask_field");
    expect(seenSystem).toMatch(/Visit booking is NOT started|start_booking/i);
    expect(seenSystem).toMatch(/NOT a booking request|explicitly ask to schedule/i);
  });

  it("does not register booking tools when capabilities are empty", async () => {
    let seenTools: string[] = [];
    let seenSystem = "";

    generateTextMock.mockImplementation(async (opts: {
      system: string;
      tools: Record<string, { execute?: (args: unknown) => Promise<unknown> }>;
    }) => {
      seenSystem = opts.system;
      seenTools = Object.keys(opts.tools).sort();
      await opts.tools.reply?.execute?.({ text: "Here is what we offer." });
      return { text: "" };
    });

    const flow = flowForCapabilities({ capabilities: [] });
    const out = await talkTurn(baseCtx(flow), talkStage(flow));

    expect(out.reply).toBe("Here is what we offer.");
    expect(seenTools).toEqual(
      expect.arrayContaining(["reply", "set_intent", "transition", "request_human"]),
    );
    expect(seenTools).not.toContain("start_booking");
    expect(seenTools).not.toContain("update_meeting_details");
    expect(seenTools).not.toContain("ask_field");
    expect(seenSystem).not.toMatch(/start_booking/);
    expect(seenSystem).toMatch(/Do not collect booking|do not collect booking/i);
  });

  it("uses proactive prompt when stance is proactive", async () => {
    let seenSystem = "";
    generateTextMock.mockImplementation(async (opts: {
      system: string;
      tools: Record<string, { execute?: (args: unknown) => Promise<unknown> }>;
    }) => {
      seenSystem = opts.system;
      await opts.tools.reply?.execute?.({ text: "Sure — want to book a visit?" });
      return { text: "" };
    });

    const flow = flowForCapabilities({
      capabilities: ["booking"],
      bookingStance: "proactive",
    });
    await talkTurn(baseCtx(flow), talkStage(flow));
    expect(seenSystem).toMatch(/book a visit when ready/i);
  });

  it("includes active collect tools after start_booking fields are set", async () => {
    let seenTools: string[] = [];
    generateTextMock.mockImplementation(async (opts: {
      tools: Record<string, { execute?: (args: unknown) => Promise<unknown> }>;
    }) => {
      seenTools = Object.keys(opts.tools).sort();
      await opts.tools.reply?.execute?.({ text: "What day works?" });
      return { text: "" };
    });

    const flow = flowForCapabilities({ capabilities: ["booking"] });
    const ctx = baseCtx(flow, {
      lead: {
        id: "l1",
        externalUserId: "+1",
        fields: { booking_flow: "active" },
      },
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "Hello" },
        { role: "lead", text: "I want to schedule a demo" },
      ],
    });
    await talkTurn(ctx, talkStage(flow));
    expect(seenTools).toEqual(
      expect.arrayContaining(["ask_field", "save_fields", "book_meeting", "confirm_details"]),
    );
  });

  it("falls back to generateText text when reply tool is not called", async () => {
    generateTextMock.mockResolvedValue({ text: "Plain model reply" });
    const flow = flowForCapabilities({ capabilities: ["booking"] });
    const out = await talkTurn(baseCtx(flow), talkStage(flow));
    expect(out.reply).toBe("Plain model reply");
  });
});
