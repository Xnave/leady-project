import { describe, expect, it } from "vitest";
import {
  askBookingField,
  bookingFieldGaps,
  capturePriorBookingAnswer,
  isMidBookingCollect,
  gateBookOnGaps,
} from "./booking";
import { callbackPhone, effectiveBookingRequired, looksLikePhoneNumber } from "./booking-collect";
import { copyFor, fillTemplate } from "@/lib/copy";
import { flowForCatalog } from "./catalog";
import { conversationIdleExpired } from "./rotate-conversation";
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

  it("detects mid-booking only after fields or confirm exist", () => {
    expect(isMidBookingCollect({})).toBe(false);
    expect(isMidBookingCollect({ name: "Nave" })).toBe(true);
    expect(isMidBookingCollect({ booking_confirm: "pending" })).toBe(true);
  });

  it("captures the customer answer to the prior canned booking ask", () => {
    const prior = askBookingField("he", "time_preference", {});
    expect(
      capturePriorBookingAnswer({
        priorAgentText: prior,
        customerText: "ביום חמישי ב12:00",
        fields: { name: "נווה" },
        required: ["time_preference", "name", "need"],
        lang: "he",
      }),
    ).toEqual({ time_preference: "ביום חמישי ב12:00" });
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
    expect(text).toMatch(/Dana/);
    expect(text).not.toMatch(/^Phone:/m);
  });
});

describe("gateBookOnGaps", () => {
  it("clears book when gaps remain without rewriting replies", () => {
    expect(gateBookOnGaps({ book: true, gaps: ["name"] })).toEqual({ book: false });
    expect(gateBookOnGaps({ book: true, gaps: [] })).toEqual({ book: true });
  });

  it("builds phone confirm asks from templates", () => {
    expect(askBookingField("en", "phone", { deducedPhone: "+972501234567" })).toMatch(
      /\+972501234567/,
    );
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
  });

  it("re-parses a Hebrew display string without duplicating the time", () => {
    const out = normalizeSlot("10 בספטמבר 2026 בשעה 10:00", {
      now: new Date("2026-09-08T10:00:00"),
      lang: "he",
    });
    expect(out.dateLabel).toBe("10 בספטמבר 2026");
    expect(out.timeLabel).toBe("10:00");
    expect(out.display).toBe("10 בספטמבר 2026 בשעה 10:00");
  });

  it("parses dotted day.month.yy with colon time (not 11:11)", () => {
    const out = normalizeSlot("11.11.26 10:00", {
      now: new Date("2026-09-08T10:00:00"),
      lang: "he",
    });
    expect(out.dateIso).toBe("2026-11-11");
    expect(out.time).toBe("10:00");
    expect(out.display).toBe("11 בנובמבר 2026 בשעה 10:00");
  });

  it("time-only does not put בשעה into dateLabel", () => {
    const out = normalizeSlot("בשעה 10:00", { lang: "he" });
    expect(out.dateLabel).toBe("");
    expect(out.timeLabel).toBe("10:00");
  });
});

describe("proposesDifferentSlot", () => {
  it("detects a new weekday+time vs a concrete staff offer", async () => {
    const { proposesDifferentSlot } = await import("./slot");
    const now = new Date("2026-09-08T12:00:00");
    expect(
      proposesDifferentSlot("אני רוצה לקבוע פגישה ליום ראשון ב11", "11 בנובמבר 2026 בשעה 10:00", {
        lang: "he",
        now,
      }),
    ).toBe(true);
  });

  it("allows plain yes without a competing slot", async () => {
    const { proposesDifferentSlot } = await import("./slot");
    expect(
      proposesDifferentSlot("כן", "11 בנובמבר 2026 בשעה 10:00", { lang: "he" }),
    ).toBe(false);
  });

  it("detects same day but different clock time", async () => {
    const { proposesDifferentSlot } = await import("./slot");
    expect(
      proposesDifferentSlot("ב-11:00", "11 בנובמבר 2026 בשעה 10:00", { lang: "he" }),
    ).toBe(true);
  });
});

describe("getStaffSlotOffer", () => {
  it("reads a pending staff offer from lead fields", async () => {
    const { getStaffSlotOffer } = await import("@/lib/meetings");
    expect(getStaffSlotOffer({})).toBeNull();
    expect(
      getStaffSlotOffer({
        staff_slot_offer: {
          meetingId: "m1",
          slot: "11 בנובמבר 2026 בשעה 10:00",
          previousSlot: "old",
        },
      }),
    ).toEqual({
      meetingId: "m1",
      slot: "11 בנובמבר 2026 בשעה 10:00",
      previousSlot: "old",
    });
  });
});

describe("conversationIdleExpired", () => {
  it("detects idle past the tenant window", () => {
    expect(
      conversationIdleExpired({
        lastMessageAt: new Date("2026-09-01T10:00:00Z"),
        idleResetDays: 5,
        now: new Date("2026-09-08T10:00:00Z"),
      }),
    ).toBe(true);
    expect(
      conversationIdleExpired({
        lastMessageAt: new Date("2026-09-07T10:00:00Z"),
        idleResetDays: 5,
        now: new Date("2026-09-08T10:00:00Z"),
      }),
    ).toBe(false);
  });
});

describe("catalog flows", () => {
  it("orders waiting_human before done in displayOrder", () => {
    const inbox = flowForCatalog("inbox");
    expect(inbox.displayOrder?.indexOf("waiting_human")).toBeLessThan(
      inbox.displayOrder!.indexOf("done"),
    );
    expect(flowForCatalog("faq").stages.talk).toMatchObject({ allowBook: false });
  });
});
