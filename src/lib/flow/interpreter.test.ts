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

  it("skips while waiting_human unless resume", async () => {
    const state = ctx({
      conversation: {
        id: "c1",
        status: "waiting_human",
        flowState: "waiting_human",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
    });
    const result = await interpretTurn(state, {}, ports());
    expect(result.skipped).toBe("waiting_human");
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
        { role: "human", text: "Owner handled it — continue" },
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

  it("sends intro after done instead of ignoring the new message", async () => {
    const replies: string[] = [];
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
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(result.skipped).toBeUndefined();
    expect(result.action).toBe("canned_intro");
    expect(replies[0]).toBe("We design and install kitchens.");
  });

  it("talk sends the onboard intro without calling the model on the first turn", async () => {
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
        return { reply: "should not run" };
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(talked).toBe(false);
    expect(result.action).toBe("canned_intro");
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("We design and install kitchens.");
    expect(state.lead.fields.name).toBeUndefined();
  });

  it("sends the intro again after the conversation is done", async () => {
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
        return { reply: "should not run" };
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(talked).toBe(false);
    expect(result.action).toBe("canned_intro");
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("We design and install kitchens.");
  });

  it("sends the intro after idle days without calling the model", async () => {
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
        return { reply: "should not run" };
      },
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(talked).toBe(false);
    expect(result.action).toBe("canned_intro");
    expect(replies[0]).toBe("We design and install kitchens.");
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
        book: true,
      }),
      sendAndSave: async (_c, text) => {
        replies.push(text);
      },
    });
    expect(result.action).not.toBe("book_meeting");
    expect(result.stage).toBe("talk");
    expect(replies[0]).toBe("תודה, נמשיך עם התכנון.");
  });

  it("talk books a tentative visit and stays in talk", async () => {
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
    expect(result.stage).toBe("talk");
    expect(replies[0]).toMatch(/ההזמנה נקלטה/);
    expect(replies[0]).toMatch(/הרוגוזין/);
    expect(replies[0]).not.toMatch(/כתובת\?/);
  });
});
