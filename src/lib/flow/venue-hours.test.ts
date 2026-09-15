import { describe, expect, it } from "vitest";
import {
  isSlotWithinVenueHours,
  lastBookableMinutes,
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
});

describe("isSlotWithinVenueHours", () => {
  const hours = "א-ה 9-19";

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
});
