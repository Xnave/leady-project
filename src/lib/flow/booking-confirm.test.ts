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
    expect(collected.reply).toMatch(/בשעה 12:00/);
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

  it("ask_field need presents transcript interest when CRM interest is empty", async () => {
    const fields = {
      booking_flow: "active",
      time_preference: "8 באוקטובר 2026 בשעה 17:00",
      name: "נווה עיני",
      name_collected_by_agent: "1",
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
      execute: (args: { field: string }) => Promise<unknown>;
    };
    await ask.execute({ field: "need" });
    expect(collected.reply).toMatch(/הנה מה שהבנתי עד עכשיו/);
    expect(collected.reply).toMatch(/שעות הפניות|מפת הזדמנויות/);
    expect(String(collected.fields.interest ?? "")).toMatch(/שעות הפניות|מפת הזדמנויות/);
  });
});
