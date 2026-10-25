import { beforeEach, describe, expect, it } from "vitest";
import { ensureFlowRegistry } from "./capabilities";
import { flowForCapabilities } from "./catalog";
import { getCapability } from "./registry";
import type { TalkStage, TurnContext } from "./types";
import { defaultHitlPolicy, defaultLeadSchema } from "./validate";
import { bookingInstance } from "./booking-config";

function ctxWithFields(fields: Record<string, unknown>): TurnContext {
  const flow = flowForCapabilities({ capabilities: ["booking"] });
  return {
    tenantId: "t1",
    tenant: {
      name: "Demo Co",
      phone: "",
      intro: "We help.",
      chatLanguage: "he",
      capabilityInstances: [
        bookingInstance({ venueHours: "א-ה 9-19", venueAddress: "1 Main" }),
      ],
    },
    agent: {
      id: "a1",
      tenantId: "t1",
      catalogId: "inbox",
      systemPrompt: "BASE",
      knowledgeText: "",
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
    lead: { id: "l1", externalUserId: "1422526199846123", fields },
    messages: [
      {
        role: "lead",
        text: "היי, סיימתי מפת הזדמנויות. המענה לא מכסה את כל שעות הפניות אצלנו בקליניקה.",
      },
    ],
    channel: { provider: "instagram", customerPhone: "1422526199846123" },
  };
}

describe("booking confirm_details rails", () => {
  beforeEach(() => {
    ensureFlowRegistry();
  });

  it("builds deterministic confirm with calendar slot and skips a second confirm", async () => {
    const fields = {
      booking_flow: "active",
      time_preference: "מחר ב12",
      name: "נווה עיני",
      need: "מענה לא מכסה שעות פניות",
      phone: "0526595639",
    };
    const ctx = ctxWithFields(fields);
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
      replyLocked?: boolean;
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const confirm = tools.confirm_details as {
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    };

    const first = await confirm.execute({});
    expect(first).toBe("ok");
    expect(collected.reply).toMatch(/הנה פרטי הפגישה/);
    expect(collected.reply).toMatch(/פרטי הפגישה: מענה לא מכסה/);
    expect(collected.reply).toMatch(/מועד:/);
    expect(collected.reply).not.toMatch(/מחר ב12|מחר ב-12/);
    expect(collected.reply).toMatch(/יום \S+ בשעה 12:00 בתאריך \d+ ב/);
    expect(collected.reply).toMatch(/052-659-5639|0526595639/);
    expect(collected.fields.booking_confirm).toBe("pending");

    const before = collected.reply;
    const secondCtx = {
      ...ctx,
      lead: {
        ...ctx.lead,
        fields: { ...fields, booking_confirm: "pending", ...collected.fields },
      },
    };
    const collected2: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: before, fields: { booking_confirm: "pending" }, effects: [] };
    const tools2 = getCapability("booking")!.tools!({
      ctx: secondCtx,
      stage,
      collected: collected2,
    });
    const confirm2 = tools2.confirm_details as {
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    };
    const second = await confirm2.execute({});
    expect(JSON.parse(String(second))).toMatchObject({ ok: false, skip: true });
    expect(collected2.reply).toBe(before);
  });

  it("confirm_details while pending appends a תוסיף extra instead of skip", async () => {
    const fields = {
      booking_flow: "active",
      booking_confirm: "pending",
      time_preference: "9 באוקטובר בשעה 13:00",
      name: "נווה עיני 2",
      need: "demo",
      phone: "0526595639",
    };
    const ctx = ctxWithFields(fields);
    ctx.messages = [{ role: "lead", text: "תוסיף שאנחנו עסק בתחום הנדלן" }];
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
      replyLocked?: boolean;
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const confirm = tools.confirm_details as {
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    };
    const result = await confirm.execute({});
    expect(JSON.parse(String(result))).toMatchObject({ ok: true, amended: "need" });
    expect(collected.fields.need).toMatch(/נדלן/);
    expect(collected.reply).toMatch(/הנה פרטי הפגישה/);
    expect(collected.reply).toMatch(/נדלן/);
    expect(collected.reply).toMatch(/מועד:/);
    expect(collected.replyLocked).toBe(true);
  });

  it("ask_field need waits for a saved understanding instead of pasting the opener", async () => {
    const fields = {
      booking_flow: "active",
      time_preference: "8 באוקטובר 2026 בשעה 17:00",
      name: "נווה עיני",
      name_collected_by_agent: "1",
      interest: "היי, סיימתי מפת הזדמנויות. המענה לא מכסה את כל שעות הפניות אצלנו בקליניקה.",
    };
    const ctx = ctxWithFields(fields);
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
      askFieldUsed?: boolean;
      replyLocked?: boolean;
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const ask = tools.ask_field as {
      execute: (args: { field: string }) => Promise<string>;
    };
    const result = JSON.parse(await ask.execute({ field: "need" }));
    expect(result.error).toBe("missing_interest");
    expect(result.hint).toMatch(/save_interest/);
    expect(collected.reply).toBe("");
    expect(collected.replyLocked).toBeUndefined();
  });

  it("ask_field need presents the understanding already saved on interest", async () => {
    const understood = "רוצה דמו כדי לראות איך הסוכן מתאים לעסק";
    const fields = {
      booking_flow: "active",
      time_preference: "8 באוקטובר 2026 בשעה 17:00",
      name: "נווה עיני",
      name_collected_by_agent: "1",
      interest: understood,
    };
    const ctx = ctxWithFields(fields);
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const ask = tools.ask_field as {
      execute: (args: { field: string }) => Promise<unknown>;
    };
    await ask.execute({ field: "need" });
    expect(collected.reply).toMatch(/פרטי הפגישה/);
    expect(collected.reply).toMatch(new RegExp(understood));
    expect(collected.reply).toMatch(/לאשר או שתרצה להוסיף/);
  });

  it("save_fields yes keeps the understanding and does not append כן", async () => {
    const understood = "רוצה דמו כדי לראות התאמה לעסק";
    const fields = {
      booking_flow: "active",
      time_preference: "8 באוקטובר 2026 בשעה 17:00",
      name: "נווה עיני",
      interest: understood,
    };
    const ctx = ctxWithFields(fields);
    ctx.messages = [{ role: "lead", text: "כן" }];
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const save = tools.save_fields as {
      execute: (args: Record<string, string>) => Promise<unknown>;
    };
    await save.execute({ need: "כן" });
    expect(collected.fields.need).toBe(understood);
  });

  it("does not store the opener when save_fields pastes it as need", async () => {
    const opener = "היי Zapidly, אשמח לקבל דמו ולראות איך הסוכן יכול להתאים לעסק שלי";
    const ctx = ctxWithFields({ booking_flow: "active" });
    ctx.messages = [{ role: "lead", text: opener }];
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const save = tools.save_fields as {
      execute: (args: Record<string, string>) => Promise<string>;
    };
    const result = JSON.parse(await save.execute({ need: opener }));
    expect(result.error).toBe("verbatim");
    expect(collected.fields.need).toBeUndefined();
  });

  it("rejects a clock the customer did not say", async () => {
    const ctx = ctxWithFields({ booking_flow: "active" });
    ctx.messages = [{ role: "lead", text: "מחר" }];
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
      replyLocked?: boolean;
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const save = tools.save_fields as {
      execute: (args: Record<string, string>) => Promise<string>;
    };
    const result = JSON.parse(await save.execute({ time_preference: "23 באוקטובר בשעה 10:00" }));
    expect(result.error).toBe("unclear_time");
    expect(collected.reply).toMatch(/יום ושעה/);
    expect(collected.fields.time_preference).toBeUndefined();
  });

  it("saves a clock the customer named", async () => {
    const ctx = ctxWithFields({ booking_flow: "active" });
    ctx.messages = [{ role: "lead", text: "מחר ב-17:00" }];
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const save = tools.save_fields as {
      execute: (args: Record<string, string>) => Promise<unknown>;
    };
    await save.execute({ time_preference: "מחר ב-17:00" });
    expect(String(collected.fields.time_preference ?? "")).toMatch(/17:00/);
  });

  it("saves בשעה 17 as 17:00 and ignores a closing hour the lead only quoted", async () => {
    const ctx = ctxWithFields({ booking_flow: "active" });
    ctx.messages = [{ role: "lead", text: "מחר בשעה 17" }];
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const save = tools.save_fields as {
      execute: (args: Record<string, string>) => Promise<string>;
    };
    await save.execute({ time_preference: "מחר בשעה 17:00" });
    expect(String(collected.fields.time_preference ?? "")).toMatch(/17:00/);

    const quoted = ctxWithFields({ booking_flow: "active" });
    quoted.messages = [{ role: "lead", text: "ראיתי שאתם פתוחים עד 19:00" }];
    const quotedCollected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: "", fields: {}, effects: [] };
    const quotedTools = getCapability("booking")!.tools!({
      ctx: quoted,
      stage,
      collected: quotedCollected,
    });
    const quotedSave = quotedTools.save_fields as {
      execute: (args: Record<string, string>) => Promise<string>;
    };
    const rejected = JSON.parse(
      await quotedSave.execute({ time_preference: "מחר בשעה 19:00" }),
    );
    expect(rejected.error).toBe("unclear_time");
    expect(quotedCollected.fields.time_preference).toBeUndefined();
  });

  it("keeps a clock the customer named earlier when the latest message is only a day", async () => {
    const ctx = ctxWithFields({ booking_flow: "active" });
    ctx.messages = [
      { role: "lead", text: "אפשר ב-17:00" },
      { role: "agent", text: "איזה יום?" },
      { role: "lead", text: "מחר" },
    ];
    const stage = ctx.agent.flow.stages.talk as TalkStage;
    const collected: {
      reply: string;
      fields: Record<string, unknown>;
      effects: [];
    } = { reply: "", fields: {}, effects: [] };
    const tools = getCapability("booking")!.tools!({ ctx, stage, collected });
    const save = tools.save_fields as {
      execute: (args: Record<string, string>) => Promise<unknown>;
    };
    await save.execute({ time_preference: "26 באוקטובר בשעה 17:00" });
    expect(String(collected.fields.time_preference ?? "")).toMatch(/17:00/);
  });
});
