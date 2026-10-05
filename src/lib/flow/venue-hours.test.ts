import { describe, expect, it } from "vitest";
import {
  checkBookableSlot,
  isSlotWithinVenueHours,
  lastBookableMinutes,
  normalizeVenueSchedule,
  parseDaysFromHoursPrefix,
  parseVenueHoursSegments,
  parseVenueHoursWindow,
  parseVenueSchedule,
  windowFromSchedule,
} from "./venue-hours";

describe("parseVenueHoursWindow", () => {
  it("parses Hebrew shorthand and English ranges", () => {
    expect(parseVenueHoursWindow("א-ה 9-19")).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 19 * 60,
    });
    expect(parseVenueHoursWindow("Sun–Thu 09:00–19:00")).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 19 * 60,
    });
  });

  it("prefers the weekday clause over a trailing Friday window when day is unknown", () => {
    const dual = "ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00";
    expect(parseVenueHoursWindow(dual)).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 19 * 60,
    });
    expect(parseVenueHoursWindow(dual, /* Wednesday */ 3)).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 19 * 60,
    });
    expect(parseVenueHoursWindow(dual, /* Friday */ 5)).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 13 * 60,
    });
    expect(parseVenueHoursWindow(dual, /* Saturday */ 6)).toBeNull();
  });
});

describe("normalizeVenueSchedule", () => {
  it("persists day-scoped HH:MM windows from free text", () => {
    const hours =
      "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00 | שבת סגור";
    expect(normalizeVenueSchedule(hours)).toEqual([
      { days: [0, 2, 4], open: "09:00", close: "19:00" },
      { days: [1, 3], open: "09:00", close: "15:00" },
      { days: [5], open: "09:00", close: "13:00" },
    ]);
  });

  it("round-trips through parseVenueSchedule", () => {
    const schedule = normalizeVenueSchedule("Sun–Thu 09:00–19:00, Fri 09:00–13:00");
    expect(parseVenueSchedule(schedule)).toEqual(schedule);
    expect(windowFromSchedule(schedule, 1)).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 19 * 60,
    });
    expect(windowFromSchedule(schedule, 5)).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 13 * 60,
    });
  });
});

describe("parseDaysFromHoursPrefix / segments", () => {
  it("reads Hebrew and English day labels, ranges, and lists", () => {
    expect(parseDaysFromHoursPrefix("ימים א'-ה'")).toEqual([0, 1, 2, 3, 4]);
    expect(parseDaysFromHoursPrefix("יום ו'")).toEqual([5]);
    expect(parseDaysFromHoursPrefix("א', ג', ה'")).toEqual([0, 2, 4]);
    expect(parseDaysFromHoursPrefix("ב', ד'")).toEqual([1, 3]);
    expect(parseDaysFromHoursPrefix("שישי")).toEqual([5]);
    expect(parseDaysFromHoursPrefix("שבת")).toEqual([6]);
    expect(parseDaysFromHoursPrefix("Sun–Thu")).toEqual([0, 1, 2, 3, 4]);
    expect(parseDaysFromHoursPrefix("Fri")).toEqual([5]);
    expect(parseDaysFromHoursPrefix("Mon, Wed, Fri")).toEqual([1, 3, 5]);
  });

  it("splits dual-range venue hours into day-scoped segments", () => {
    const segs = parseVenueHoursSegments(
      "ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00",
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({
      days: [0, 1, 2, 3, 4],
      openMinutes: 9 * 60,
      closeMinutes: 19 * 60,
    });
    expect(segs[1]).toMatchObject({
      days: [5],
      openMinutes: 9 * 60,
      closeMinutes: 13 * 60,
    });
  });

  it("parses comma day-lists and Hebrew Friday name", () => {
    const hours =
      "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00 | שבת סגור";
    const segs = parseVenueHoursSegments(hours);
    expect(segs).toEqual([
      { days: [0, 2, 4], openMinutes: 9 * 60, closeMinutes: 19 * 60 },
      { days: [1, 3], openMinutes: 9 * 60, closeMinutes: 15 * 60 },
      { days: [5], openMinutes: 9 * 60, closeMinutes: 13 * 60 },
    ]);
    expect(parseVenueHoursWindow(hours, /* Tuesday */ 2)).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 19 * 60,
    });
    expect(parseVenueHoursWindow(hours, /* Monday */ 1)).toEqual({
      openMinutes: 9 * 60,
      closeMinutes: 15 * 60,
    });
    expect(parseVenueHoursWindow(hours, /* Saturday */ 6)).toBeNull();
  });
});

describe("isSlotWithinVenueHours", () => {
  const hours = "א-ה 9-19";
  // Fixed "now" so weekday relative phrases are stable in CI.
  const wedMorning = new Date(2026, 8, 23, 10, 0, 0); // Wed Sep 23 2026

  it("accepts times well inside the window", () => {
    expect(
      isSlotWithinVenueHours("היום ב10 בבוקר", hours, { lang: "he", now: wedMorning }),
    ).toBe(true);
    expect(
      isSlotWithinVenueHours("Thursday 18:00", hours, { lang: "en", now: wedMorning }),
    ).toBe(true);
    expect(
      isSlotWithinVenueHours("מחר ב6 בערב", hours, { lang: "he", now: wedMorning }),
    ).toBe(true);
  });

  it("allows up to 30 minutes before close, not at closing", () => {
    const window = parseVenueHoursWindow(hours)!;
    expect(lastBookableMinutes(window)).toBe(18 * 60 + 30);
    expect(isSlotWithinVenueHours("today at 18:30", hours, { lang: "en" })).toBe(true);
    expect(isSlotWithinVenueHours("מחר ב7 בערב", hours, { lang: "he" })).toBe(false);
    expect(isSlotWithinVenueHours("today at 19:00", hours, { lang: "en" })).toBe(false);
  });

  it("rejects evening times past close", () => {
    expect(isSlotWithinVenueHours("היום ב9 בערב", hours, { lang: "he" })).toBe(false);
    expect(isSlotWithinVenueHours("today at 21:00", hours, { lang: "en" })).toBe(false);
  });

  it("returns null when clock time or hours are unclear", () => {
    expect(isSlotWithinVenueHours("מחר בבוקר", hours, { lang: "he" })).toBeNull();
    expect(isSlotWithinVenueHours("היום ב10:00", "by appointment", { lang: "he" })).toBeNull();
  });

  it("uses the weekday window from dual-range hours, not the Friday clause", () => {
    const dual = "ימים א'-ה' 09:00-19:00, יום ו' 09:00-13:00";
    expect(
      isSlotWithinVenueHours("רביעי ב6 בערב", dual, { lang: "he", now: wedMorning }),
    ).toBe(true);
    expect(
      isSlotWithinVenueHours("רביעי ב18:00", dual, { lang: "he", now: wedMorning }),
    ).toBe(true);
    expect(
      isSlotWithinVenueHours("רביעי ב7 בערב", dual, { lang: "he", now: wedMorning }),
    ).toBe(false);
    expect(
      isSlotWithinVenueHours("יום שישי ב11:00", dual, { lang: "he", now: wedMorning }),
    ).toBe(true);
    expect(
      isSlotWithinVenueHours("יום שישי ב6 בערב", dual, { lang: "he", now: wedMorning }),
    ).toBe(false);
  });

  it("handles per-day lists like א'/ג'/ה' vs ב'/ד' vs שישי", () => {
    const list =
      "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00 | שבת סגור";
    expect(
      isSlotWithinVenueHours("ביום שלישי ב6 בערב", list, {
        lang: "he",
        now: wedMorning,
      }),
    ).toBe(true);
    expect(
      isSlotWithinVenueHours("יום ב בשעה 18:00", list, {
        lang: "he",
        now: wedMorning,
      }),
    ).toBe(false);
    expect(
      isSlotWithinVenueHours("יום שישי ב14:00", list, {
        lang: "he",
        now: wedMorning,
      }),
    ).toBe(false);
    expect(
      isSlotWithinVenueHours("יום שישי ב11:00", list, {
        lang: "he",
        now: wedMorning,
      }),
    ).toBe(true);
  });

  it("prefers a persisted schedule over re-parsing the label", () => {
    const schedule = normalizeVenueSchedule(
      "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00",
    );
    expect(
      isSlotWithinVenueHours("ביום שלישי ב6 בערב", "ignored garbage", {
        lang: "he",
        now: wedMorning,
        schedule,
      }),
    ).toBe(true);
  });
});

describe("checkBookableSlot", () => {
  const list =
    "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00 | שבת סגור";
  const wedMorning = new Date(2026, 8, 23, 10, 0, 0);
  const schedule = normalizeVenueSchedule(list);

  it("marks bare hours as ambiguous", () => {
    expect(
      checkBookableSlot({
        slotText: "רביעי ב6",
        hoursLabel: list,
        schedule,
        lang: "he",
        now: wedMorning,
      }).status,
    ).toBe("ambiguous_time");
  });

  it("accepts evening-marked and explicit clock times", () => {
    // שלישי (Tue) is in the long א'/ג'/ה' window; רביעי (Wed) is the short ב'/ד' window.
    expect(
      checkBookableSlot({
        slotText: "שלישי ב6 בערב",
        hoursLabel: list,
        schedule,
        lang: "he",
        now: wedMorning,
      }).status,
    ).toBe("ok");
    expect(
      checkBookableSlot({
        slotText: "ביום שלישי ב18:00",
        hoursLabel: list,
        schedule,
        lang: "he",
        now: wedMorning,
      }).status,
    ).toBe("ok");
  });

  it("rejects fuzzy time without a clock when hours are configured", () => {
    expect(
      checkBookableSlot({
        slotText: "מחר בבוקר",
        hoursLabel: list,
        schedule,
        lang: "he",
        now: wedMorning,
      }).status,
    ).toBe("unclear_time");
  });

  it("returns invalid_hours for unparseable venue hours", () => {
    expect(
      checkBookableSlot({
        slotText: "Thursday 10:00",
        hoursLabel: "by appointment",
        lang: "en",
      }).status,
    ).toBe("invalid_hours");
  });

  it("skips the gate when no hours are configured", () => {
    expect(
      checkBookableSlot({
        slotText: "רביעי ב6",
        hoursLabel: "",
        lang: "he",
      }).status,
    ).toBe("ok");
  });

  it("rejects Monday evening against the short Mon/Wed window", () => {
    expect(
      checkBookableSlot({
        slotText: "יום ב בשעה 18:00",
        hoursLabel: list,
        schedule,
        lang: "he",
        now: wedMorning,
      }).status,
    ).toBe("outside_hours");
  });
});
