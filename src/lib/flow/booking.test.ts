import { describe, expect, it } from "vitest";
import {
  bookingFieldGaps,
  finalizeTalkReply,
  inferTalkIntent,
  looksLikePhoneConfirm,
} from "./booking";
import { callbackPhone, effectiveBookingRequired, looksLikePhoneNumber } from "./booking-collect";
import { copyFor, fillTemplate } from "@/lib/copy";
import { flowForCatalog } from "./catalog";
import { normalizeSlot } from "./slot";
import type { TurnContext } from "./types";
import { defaultHitlPolicy, defaultLeadSchema } from "./validate";

describe("booking helpers", () => {
  it("asks for time then name then need by default", () => {
    expect(bookingFieldGaps({})[0]).toBe("time_preference");
    expect(bookingFieldGaps({ time_preference: "Thursday 18:00" })[0]).toBe("name");
    expect(
      bookingFieldGaps({ time_preference: "Thursday 18:00", name: "Nave" })[0],
    ).toBe("need");
    expect(
      bookingFieldGaps({
        time_preference: "Thursday 18:00",
        name: "Nave",
        need: "product demo",
      }),
    ).toEqual([]);
  });

  it("only asks for phone when that field is required", () => {
    expect(
      bookingFieldGaps(
        { time_preference: "Thursday 18:00", name: "Nave" },
        ["time_preference", "name", "phone"],
      )[0],
    ).toBe("phone");
  });

  it("fills booking templates and drops empty labeled lines", () => {
    const text = fillTemplate(copyFor("en").chat.bookingRequestTemplate, {
      slot: "Thu 18:00",
      date: "September 10, 2026",
      time: "18:00",
      kind: "visit",
      need: "quote",
      details: "quote",
      name: "Dana",
      phone: "",
      email: "",
      address: "1 Main St",
      hours: "",
    });
    expect(text).toMatch(/September 10, 2026/);
    expect(text).toMatch(/18:00/);
    expect(text).toMatch(/quote/);
    expect(text).toMatch(/Dana/);
    expect(text).toMatch(/1 Main St/);
    expect(text).not.toMatch(/^Phone:/m);
  });
});

describe("finalizeTalkReply", () => {
  it("sends only the missing-field ask when booking is incomplete", () => {
    const out = finalizeTalkReply({
      reply: "Great, I'll request that visit.",
      book: true,
      lang: "en",
      hours: "Sun–Thu 09:00–19:00",
      gaps: ["phone"],
      lastAgentText: "When works for you?",
    });
    expect(out.book).toBe(false);
    expect(out.reply).toMatch(/phone number/i);
    expect(out.reply).not.toMatch(/Great, I'll request/);
  });

  it("confirms a deduced phone instead of a blank ask", () => {
    const out = finalizeTalkReply({
      reply: "Saving now.",
      book: true,
      lang: "en",
      hours: "",
      gaps: ["phone"],
      lastAgentText: "When works for you?",
      deducedPhone: "+972501234567",
    });
    expect(out.reply).toMatch(/\+972501234567/);
    expect(out.reply).toMatch(/work/i);
  });

  it("does not send the same phone ask twice", () => {
    const ask = copyFor("en").chat.askPhone;
    const out = finalizeTalkReply({
      reply: "Saving now.",
      book: true,
      lang: "en",
      hours: "",
      gaps: ["phone"],
      lastAgentText: ask,
    });
    expect(out.book).toBe(false);
    expect(out.reply).toMatch(/still need a callback/i);
    expect(out.reply).not.toBe(ask);
  });

  it("does not paste hours onto a question that is not about time", () => {
    const out = finalizeTalkReply({
      reply: "What do you need from the visit?",
      book: false,
      lang: "en",
      hours: "Sun–Thu 09:00–19:00",
      gaps: ["time_preference"],
      lastAgentText: "",
    });
    expect(out.reply).not.toMatch(/Sun–Thu/);
  });

  it("adds hours when the reply is a time question", () => {
    const out = finalizeTalkReply({
      reply: "What day and time works for you?",
      book: false,
      lang: "en",
      hours: "Sun–Thu 09:00–19:00",
      gaps: ["time_preference"],
      lastAgentText: "",
    });
    expect(out.reply).toMatch(/Sun–Thu 09:00–19:00/);
  });
});

describe("inferTalkIntent", () => {
  it("prefers support for warranty and no-shows", () => {
    expect(inferTalkIntent("warranty claim visit")).toBe("support");
    expect(inferTalkIntent("Your installer never showed up")).toBe("support");
  });

  it("maps quotes and bookings to sales", () => {
    expect(inferTalkIntent("I want a quote for a new kitchen")).toBe("sales");
  });
});

describe("phone confirm helpers", () => {
  it("detects short yes replies", () => {
    expect(looksLikePhoneConfirm("כן")).toBe(true);
    expect(looksLikePhoneConfirm("yes")).toBe(true);
    expect(looksLikePhoneConfirm("I want Tuesday")).toBe(false);
  });
});

describe("callbackPhone", () => {
  it("uses a numeric WhatsApp sender id when fields.phone is empty", () => {
    const ctx = {
      lead: { id: "l1", externalUserId: "+972501234567", fields: {} },
      channel: { provider: "whatsapp" as const },
    } as TurnContext;
    expect(looksLikePhoneNumber("+972501234567")).toBe(true);
    expect(callbackPhone(ctx)).toBe("+972501234567");
  });

  it("keeps phone required for demo leads when configured", () => {
    const flow = flowForCatalog("inbox");
    const talk = flow.stages.talk;
    if (talk?.type === "talk") {
      talk.required_for_book = ["time_preference", "name", "need", "phone"];
    }
    const ctx = {
      lead: { id: "l1", externalUserId: "demo-xyz", fields: {} },
      channel: { provider: "whatsapp" as const },
      agent: {
        id: "a1",
        tenantId: "t1",
        flow,
        flowVersion: 1,
        leadSchema: defaultLeadSchema,
        hitlPolicy: defaultHitlPolicy,
        systemPrompt: "",
        knowledgeText: "",
      },
      conversation: {
        id: "c1",
        status: "open" as const,
        flowState: "talk",
        flowVersion: 1,
        nudgeCountByStage: {},
      },
      tenantId: "t1",
      messages: [],
    } as TurnContext;
    expect(effectiveBookingRequired(ctx)).toContain("phone");
  });
});

describe("normalizeSlot", () => {
  it("turns Hebrew tomorrow + time into a concrete datetime", () => {
    const out = normalizeSlot("מחר ב-14:00", {
      now: new Date("2026-09-08T10:00:00"),
      lang: "he",
    });
    expect(out.dateIso).toBe("2026-09-09");
    expect(out.time).toBe("14:00");
    expect(out.display).toMatch(/9 בספטמבר 2026/);
    expect(out.display).toMatch(/14:00/);
  });

  it("turns English Tuesday morning into next Tuesday", () => {
    const out = normalizeSlot("Tuesday at 10 in the morning", {
      now: new Date("2026-09-08T10:00:00"),
      lang: "en",
    });
    expect(out.dateIso).toBe("2026-09-15");
    expect(out.time).toBe("10:00");
  });
});
