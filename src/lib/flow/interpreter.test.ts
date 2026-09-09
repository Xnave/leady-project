import { describe, expect, it } from "vitest";
import { interpretTurn, type InterpreterPorts } from "./interpreter";
import type { LeadFields, TurnContext } from "./types";
import { salesOrSupportFlow } from "./templates";
import { defaultFlow, defaultHitlPolicy, defaultLeadSchema } from "./validate";

function ctx(overrides?: Partial<TurnContext>): TurnContext {
  return {
    tenantId: "t1",
    tenant: { name: "Demo Kitchen Co", phone: "", intro: "We design and install kitchens.", chatLanguage: "en" },
    agent: {
      id: "a1",
      tenantId: "t1",
      systemPrompt: "",
      knowledgeText: "Filters reset with the side button.",
      flow: salesOrSupportFlow,
      flowVersion: 1,
      leadSchema: defaultLeadSchema,
      hitlPolicy: defaultHitlPolicy,
    },
    conversation: {
      id: "c1",
      status: "open",
      flowState: "classify_intent",
      flowVersion: 1,
      nudgeCountByStage: {},
    },
    lead: { id: "l1", externalUserId: "+1", fields: {} },
    messages: [{ role: "lead", text: "Hi, I want a kitchen quote" }],
    ...overrides,
  };
}

function ports(extract: LeadFields = {}): InterpreterPorts {
  return {
    classify: async () => "sales",
    extract: async () => extract,
    draftQuestion: async (_c, _s, missing) => `ask ${missing[0]}`,
    answerFaq: async () => ({ resolved: true, reply: "faq" }),
    talk: async () => ({ reply: "hello from talk" }),
    bookMeeting: async (c) =>
      c.lead.fields.email
        ? { ok: true, reply: "booked" }
        : { ok: false, reply: "need email" },
    requestHuman: async () => undefined,
    persistStage: async (c, id) => {
      c.conversation.flowState = id;
    },
    persistFields: async (c, fields) => {
      c.lead.fields = fields;
    },
    sendAndSave: async () => undefined,
    scheduleNudge: async () => undefined,
    log: () => undefined,
  };
}

describe("interpretTurn", () => {
  it("classifies sales and asks for the first missing collect field", async () => {
    const state = ctx();
    const p = ports({});
    const result = await interpretTurn(state, {}, p);
    expect(result.stage).toBe("collect_lead");
    expect(result.missing).toContain("name");
    expect(state.lead.fields.intent).toBe("sales");
  });

  it("books when required fields are complete on the same turn", async () => {
    const state = ctx({
      messages: [
        { role: "lead", text: "Full remodel. I'm Dana, dana@x.com" },
      ],
    });
    const p = ports({ name: "Dana", email: "dana@x.com", service: "remodel" });
    const result = await interpretTurn(state, {}, p);
    expect(result.action).toBe("book_meeting");
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("done");
  });

  it("skips while waiting_human unless resume, and sends a holding line once", async () => {
    const replies: string[] = [];
    const state = ctx({
      conversation: {
        id: "c1",
        status: "waiting_human",
        flowState: "waiting_human",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      messages: [
        { role: "lead", text: "transfer me" },
        { role: "agent", text: "handing off" },
        { role: "lead", text: "hello?" },
      ],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(result.skipped).toBe("waiting_human");
    expect(result.action).toBe("waiting_human_hold");
    expect(replies[0]).toMatch(/teammate|נציג/);
  });

  it("resumes from HITL terminal instead of exiting immediately", async () => {
    const replies: string[] = [];
    const state = ctx({
      agent: { ...ctx().agent, flow: defaultFlow() },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "waiting_human",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      messages: [
        { role: "lead", text: "I need a person" },
        { role: "human", text: "Owner handled it - continue" },
      ],
    });
    const result = await interpretTurn(state, { resume: true }, {
      ...ports(),
      talk: async () => ({ reply: "thanks, we are back" }),
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(result.skipped).toBeUndefined();
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("thanks, we are back");
  });

  it("talks after done and uses the model reply while still extracting (no canned overwrite)", async () => {
    const replies: string[] = [];
    let talked = false;
    const flow = structuredClone(salesOrSupportFlow);
    flow.restartPolicy = { onNewMessage: "ignore" };
    flow.start = "talk";
    flow.stages.talk = {
      type: "talk",
      prompt: "talk",
      on_complete: "done",
      on_escalate: "escalate",
    };
    const state = ctx({
      agent: {
        ...ctx().agent,
        flow,
      },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "done",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "bye" },
        { role: "lead", text: "hello again" },
      ],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      talk: async () => {
        talked = true;
        return { reply: "what can I help with", fields: { need: "followup" } };
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(talked).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("what can I help with");
    expect(state.lead.fields.need).toBe("followup");
  });

  it("talks on the first turn, extracts fields, and sends the model reply", async () => {
    const replies: string[] = [];
    let talked = false;
    const state = ctx({
      agent: { ...ctx().agent, flow: defaultFlow() },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "talk",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      messages: [{ role: "lead", text: "Hello, I want a kitchen" }],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      talk: async () => {
        talked = true;
        return { reply: "got it, when works?", fields: { need: "kitchen" }, intent: "sales" };
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(talked).toBe(true);
    expect(result.action).not.toBe("canned_intro");
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("got it, when works?");
    expect(state.lead.fields.need).toBe("kitchen");
    expect(state.lead.fields.intent).toBe("sales");
  });

  it("talks after the conversation is done and sends the model reply", async () => {
    const replies: string[] = [];
    let talked = false;
    const state = ctx({
      agent: { ...ctx().agent, flow: defaultFlow() },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "done",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "We design and install kitchens." },
        { role: "lead", text: "thanks, bye" },
        { role: "lead", text: "hello again" },
      ],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      talk: async () => {
        talked = true;
        return { reply: "welcome back" };
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(talked).toBe(true);
    expect(result.action).not.toBe("canned_intro");
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("welcome back");
  });

  it("continues talk after a long gap when the conversation was not rotated yet", async () => {
    const replies: string[] = [];
    let talked = false;
    const now = new Date("2026-08-31T10:00:00Z");
    const state = ctx({
      tenant: {
        name: "Demo Kitchen Co",
        phone: "",
        intro: "We design and install kitchens.",
        chatLanguage: "en",
        idleResetDays: 5,
      },
      agent: { ...ctx().agent, flow: defaultFlow() },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "talk",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      messages: [
        {
          role: "lead",
          text: "hi",
          createdAt: new Date("2026-08-20T10:00:00Z"),
        },
        {
          role: "agent",
          text: "We design and install kitchens.",
          createdAt: new Date("2026-08-20T10:00:01Z"),
        },
        {
          role: "lead",
          text: "still here?",
          createdAt: now,
        },
      ],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      talk: async () => {
        talked = true;
        return { reply: "yes, still here" };
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(talked).toBe(true);
    expect(result.action).not.toBe("canned_intro");
    expect(replies[0]).toBe("yes, still here");
  });

  it("talk does not book just because name and email were saved", async () => {
    const replies: string[] = [];
    const state = ctx({
      agent: { ...ctx().agent, flow: defaultFlow() },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "talk",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      lead: { id: "l1", externalUserId: "+1", fields: {} },
      messages: [
        { role: "lead", text: "אני רוצה להתאים מטבח" },
        { role: "agent", text: "מה המייל?" },
        { role: "lead", text: "naveine@gmail.com" },
      ],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      talk: async () => ({
        reply: "תודה, נמשיך עם התכנון.",
        fields: { name: "נווה", email: "naveine@gmail.com" },
        book: false,
      }),
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(result.action).not.toBe("book_meeting");
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("תודה, נמשיך עם התכנון.");
  });

  it("talk books a tentative visit and moves to waiting_human", async () => {
    const replies: string[] = [];
    const state = ctx({
      agent: { ...ctx().agent, flow: defaultFlow() },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "talk",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      lead: {
        id: "l1",
        externalUserId: "+1",
        fields: { name: "נווה", phone: "0500000000", time_preference: "רביעי 17:00" },
      },
      messages: [
        { role: "lead", text: "אני רוצה לבוא" },
        { role: "agent", text: "מתי נוח?" },
        { role: "lead", text: "ברביעי ב5" },
      ],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      talk: async () => ({
        reply: "מעולה, מחכים לך. צריך כתובת?",
        book: true,
      }),
      bookMeeting: async () => ({
        ok: true,
        reply: "ההזמנה נקלטה במערכת (ביקור באולם, רביעי 17:00).\nכתובת האולם: רחוב הרוגוזין 14",
      }),
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(result.action).toBe("book_meeting");
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("waiting_human");
    expect(replies[0]).toMatch(/ההזמנה נקלטה/);
    expect(replies[0]).toMatch(/הרוגוזין/);
    expect(replies[0]).not.toMatch(/כתובת\?/);
  });

  it("escalates with escalation_requested when the customer wants a human", async () => {
    let reason = "";
    const state = ctx({
      agent: { ...ctx().agent, flow: defaultFlow() },
      conversation: {
        id: "c1",
        status: "open",
        flowState: "talk",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      messages: [
        { role: "lead", text: "hi" },
        { role: "agent", text: "How can I help?" },
        { role: "lead", text: "Transfer me to a person" },
      ],
    });
    const result = await interpretTurn(state, {}, {
      ...ports(),
      talk: async () => ({
        reply: "Handing you over.",
        escalate: true,
        escalateReason: "they want a manager",
      }),
      requestHuman: async (_c, r) => {
        reason = r;
      },
    });
    expect(result.action).toBe("request_human");
    expect(reason).toBe("escalation_requested");
  });
});
