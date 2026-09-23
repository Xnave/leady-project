import { describe, expect, it } from "vitest";
import {
  isSlotWithinVenueHours,
  lastBookableMinutes,
  parseDaysFromHoursPrefix,
  parseVenueHoursSegments,
  parseVenueHoursWindow,
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

describe("parseDaysFromHoursPrefix / segments", () => {
  it("reads Hebrew and English day labels", () => {
    expect(parseDaysFromHoursPrefix("ימים א'-ה'")).toEqual([0, 1, 2, 3, 4]);
    expect(parseDaysFromHoursPrefix("יום ו'")).toEqual([5]);
    expect(parseDaysFromHoursPrefix("Sun–Thu")).toEqual([0, 1, 2, 3, 4]);
    expect(parseDaysFromHoursPrefix("Fri")).toEqual([5]);
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
});

describe("isSlotWithinVenueHours", () => {
  const hours = "א-ה 9-19";
  // Fixed "now" so weekday relative phrases are stable in CI.
  const wedMorning = new Date(2026, 8, 23, 10, 0, 0); // Wed Sep 23 2026

  it("accepts times well inside the window", () => {
    expect(isSlotWithinVenueHours("היום ב10 בבוקר", hours, { lang: "he" })).toBe(true);
    expect(isSlotWithinVenueHours("Thursday 18:00", hours, { lang: "en" })).toBe(true);
    expect(isSlotWithinVenueHours("מחר ב6 בערב", hours, { lang: "he" })).toBe(true);
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
    expect(isSlotWithinVenueHours("היום ב10", "by appointment", { lang: "he" })).toBeNull();
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
      isSlotWithinVenueHours("יום שישי ב11", dual, { lang: "he", now: wedMorning }),
    ).toBe(true);
    expect(
      isSlotWithinVenueHours("יום שישי ב6 בערב", dual, { lang: "he", now: wedMorning }),
    ).toBe(false);
  });
});
