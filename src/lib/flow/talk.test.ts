import { describe, expect, it } from "vitest";
import { heuristicTalk } from "./llm";
import { customerAskedToSchedule, customerReadyToBook } from "./locale";
import { rewriteForbiddenTalkReply } from "./guardrails";
import { flowForCatalog } from "./catalog";
import type { TalkStage, TurnContext } from "./types";
import { defaultLeadSchema, defaultHitlPolicy } from "./validate";

function talkCtx(text: string, extra?: Partial<TurnContext>): TurnContext {
  const flow = flowForCatalog("inbox");
  return {
    tenantId: "t1",
    tenant: { name: "Demo Kitchen Co", phone: "", intro: "We design and install kitchens.", chatLanguage: "en" },
    agent: {
      id: "a1",
      tenantId: "t1",
      catalogId: "inbox",
      systemPrompt: "",
      knowledgeText: "Filters reset with the side button.",
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
    expect(out.reply).toBe("We design and install kitchens.");
    expect(out.reply).not.toMatch(/name/i);
  });

  it("sends only the intro on the first quote message", () => {
    const ctx = talkCtx("I want a quote");
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toBe("We design and install kitchens.");
    expect(out.reply).not.toMatch(/your name/i);
    expect(out.book).toBeUndefined();
  });

  it("replies in Hebrew and continues when they already said they want a kitchen", () => {
    const intro = "שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור?";
    const stage = talkCtx("x").agent.flow.stages.talk as TalkStage;
    const first = talkCtx("שלום מה נשמע?", {
      tenant: { name: "מטבחי הזהב", phone: "", intro, chatLanguage: "he" },
    });
    const greet = heuristicTalk(first, stage);
    expect(greet.reply).toBe(intro);
    expect(greet.reply).not.toMatch(/Hi, we're/);

    const follow = talkCtx("אני רוצה להתאים מטבח לבית", {
      tenant: { name: "מטבחי הזהב", phone: "", intro, chatLanguage: "he" },
      messages: [
        { role: "lead", text: "שלום מה נשמע?" },
        { role: "agent", text: greet.reply },
        { role: "lead", text: "אני רוצה להתאים מטבח לבית" },
      ],
    });
    const out = heuristicTalk(follow, stage);
    expect(out.intent).toBe("sales");
    expect(out.reply).toMatch(/מטבח/);
    expect(out.reply).not.toMatch(/What would you like help with/i);
    expect(out.reply).not.toMatch(/Got it/);
  });

  it("sends only the onboard intro when the first message already states the need", () => {
    const intro = "שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור?";
    const ctx = talkCtx("אני רוצה להתאים מטבח לבית", {
      tenant: { name: "מטבחי הזהב", phone: "", intro, chatLanguage: "he" },
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toBe(intro);
    expect(out.reply).not.toMatch(/מטבח חדש או שיפוץ/);
  });

  it("does not re-ask new vs remodel after they answer and describe the kitchen", () => {
    const intro = "שלום ברוך הבא למטבחי הזהב. שמח שאתה כאן. במה אוכל לעזור?";
    const tenant = { name: "מטבחי הזהב", phone: "", intro, chatLanguage: "he" as const };
    const stage = talkCtx("x").agent.flow.stages.talk as TalkStage;
    const afterNew = talkCtx("חדש", {
      tenant,
      lead: { id: "l1", externalUserId: "+1", fields: {} },
      messages: [
        { role: "lead", text: "שלום מה נשמע?" },
        { role: "agent", text: intro },
        { role: "lead", text: "אני רוצה להתאים מטבח לבית" },
        { role: "agent", text: "מעולה — נשמח להתאים מטבח. זה מטבח חדש או שיפוץ?" },
        { role: "lead", text: "חדש" },
      ],
    });
    const mid = heuristicTalk(afterNew, stage);
    expect(mid.fields?.service).toBe("other");
    expect(mid.reply).not.toMatch(/חדש או שיפוץ/);
    expect(mid.reply).not.toMatch(/ספר לי מה אתה מחפש/);

    const afterDetails = talkCtx(
      "בעצם קניתי דירה חדשה בת\"א והמטבח שם עדיין ריק, בלי כלום. אני רוצה מטבח מודרני, בסטייל מינימליסטי, עם הרבה שטח אחסון.",
      {
        tenant,
        lead: { id: "l1", externalUserId: "+1", fields: { service: "other" } },
        messages: [
          ...afterNew.messages,
          { role: "agent", text: mid.reply },
          {
            role: "lead",
            text: "בעצם קניתי דירה חדשה בת\"א והמטבח שם עדיין ריק, בלי כלום. אני רוצה מטבח מודרני, בסטייל מינימליסטי, עם הרבה שטח אחסון.",
          },
        ],
      },
    );
    const out = heuristicTalk(afterDetails, stage);
    expect(out.reply).not.toMatch(/חדש או שיפוץ/);
    expect(out.reply).toMatch(/מדידה|אולם|פגישה/);
    expect(out.reply).not.toMatch(/ניצור עבורך תכנון/);
  });

  it("does not repeat the style question after they say we'll choose together", () => {
    const intro = "שלום ברוך הבא למטבחי הזהב.";
    const tenant = { name: "מטבחי הזהב", phone: "", intro, chatLanguage: "he" as const };
    const styleQ = "מעולה, מטבח חדש. יש כבר סגנון בראש (מודרני, כפרי…), או שנבחר יחד במדידה?";
    const ctx = talkCtx("נבחר יחד", {
      tenant,
      lead: { id: "l1", externalUserId: "+1", fields: { service: "other" } },
      messages: [
        { role: "lead", text: "אני רוצה להתאים מטבח" },
        { role: "agent", text: "מעולה — נשמח להתאים מטבח. זה מטבח חדש או שיפוץ?" },
        { role: "lead", text: "חדש" },
        { role: "agent", text: styleQ },
        { role: "lead", text: "נבחר יחד" },
      ],
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).not.toBe(styleQ);
    expect(out.reply).toMatch(/מדידה|מתי/);
  });

  it("invites a visit instead of repeating a 3D planning offer", () => {
    const intro = "שלום ברוך הבא למטבחי הזהב.";
    const tenant = { name: "מטבחי הזהב", phone: "", intro, chatLanguage: "he" as const };
    const ctx = talkCtx("kt", {
      tenant,
      lead: { id: "l1", externalUserId: "+1", fields: { service: "other" } },
      messages: [
        { role: "lead", text: "אני רוצה מטבח מודרני" },
        {
          role: "agent",
          text: "נוכל לעבור לשלב התכנון וליצור עבורך תכנון תלת-מימדי של המטבח.",
        },
        { role: "lead", text: "kt" },
      ],
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toMatch(/מדידה|אולם/);
    expect(out.reply).not.toMatch(/ניצור עבורך תכנון תלת/);
  });

  it("asks for a time when they want to come in", () => {
    const intro = "שלום ברוך הבא למטבחי הזהב.";
    const tenant = { name: "מטבחי הזהב", phone: "", intro, chatLanguage: "he" as const };
    const ctx = talkCtx("אני רוצה לבוא", {
      tenant,
      lead: { id: "l1", externalUserId: "+1", fields: { service: "other" } },
      messages: [
        { role: "lead", text: "אני רוצה להתאים מטבח" },
        { role: "agent", text: "סניף או מדידה בבית?" },
        { role: "lead", text: "אני רוצה לבוא" },
      ],
    });
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const out = heuristicTalk(ctx, stage);
    expect(out.reply).toMatch(/מתי/);
    expect(out.book).toBeUndefined();
  });
});

describe("customerAskedToSchedule", () => {
  it("is false for a kitchen fit request plus an email", () => {
    expect(
      customerAskedToSchedule([
        { role: "lead", text: "אני רוצה להתאים מטבח לבית" },
        { role: "lead", text: "naveine@gmail.com" },
      ]),
    ).toBe(false);
  });

  it("is true when they ask to schedule a measurement", () => {
    expect(
      customerAskedToSchedule([{ role: "lead", text: "אפשר לתאם מדידה לשבוע הבא?" }]),
    ).toBe(true);
  });

  it("is true when they say they will come in", () => {
    expect(
      customerAskedToSchedule([{ role: "lead", text: "אני רוצה לבוא" }]),
    ).toBe(true);
  });
});

describe("customerReadyToBook", () => {
  it("is true when they say yes after the agent offered a visit", () => {
    expect(
      customerReadyToBook([
        {
          role: "agent",
          text: "אפשר לקבוע מדידה או ביקור באולם? מתי נוח?",
        },
        { role: "lead", text: "כן" },
      ]),
    ).toBe(true);
  });

  it("is true when they give a time after being asked when", () => {
    expect(
      customerReadyToBook([
        { role: "agent", text: "מתי היית מעוניין לבוא אלינו?" },
        { role: "lead", text: "ברביעי ב5 אחרצ" },
      ]),
    ).toBe(true);
  });
});

describe("rewriteForbiddenTalkReply", () => {
  it("replaces an in-chat 3D offer with a meeting invite", () => {
    const out = rewriteForbiddenTalkReply(
      "כעת, אם תרצה, נוכל לעבור לשלב התכנון וליצור עבורך תכנון תלת-מימדי של המטבח.",
      "he",
    );
    expect(out).toMatch(/מדידה|אולם/);
    expect(out).not.toMatch(/ניצור עבורך/);
  });

  it("leaves a denial that 3D is not done in chat", () => {
    const reply =
      "תודה, רשמתי. אני לא מעצב ולא בונה תכנון תלת-ממדי בצ'אט — זה בפגישה עם הצוות. אפשר לקבוע מדידה?";
    expect(rewriteForbiddenTalkReply(reply, "he")).toBe(reply);
  });
});
