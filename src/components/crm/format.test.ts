import { describe, expect, it } from "vitest";
import { dateTimeAt, initials, isoToTimeInput, presetAt, presetOf, relTime, untilTime } from "./format";

const now = new Date(2026, 8, 25, 14, 30);
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

describe("relTime", () => {
  it("uses minutes, hours, then days", () => {
    expect(relTime(ago(5), "en", now)).toBe("5 min. ago");
    expect(relTime(ago(180), "en", now)).toBe("3 hr. ago");
    expect(relTime(ago(1440), "en", now)).toBe("yesterday");
    expect(relTime(ago(4 * 1440), "en", now)).toBe("4 days ago");
  });
  it("clamps future times to now", () => {
    expect(relTime(ago(-30), "en", now)).toBe(relTime(ago(0), "en", now));
  });
  it("speaks Hebrew", () => {
    expect(relTime(ago(1440), "he", now)).toBe("אתמול");
  });
});

describe("untilTime", () => {
  it("counts calendar days", () => {
    expect(untilTime(new Date(2026, 8, 25, 23, 0).toISOString(), "en", now)).toBe("today");
    expect(untilTime(new Date(2026, 8, 26, 9, 0).toISOString(), "en", now)).toBe("tomorrow");
    expect(untilTime(new Date(2026, 8, 28, 9, 0).toISOString(), "en", now)).toBe("in 3 days");
  });
});

describe("presetAt", () => {
  it("lands on 09:00 local time", () => {
    const d = new Date(presetAt(3, now));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([28, 9, 0]);
  });
  it("crosses month ends", () => {
    const d = new Date(presetAt(7, now));
    expect([d.getMonth(), d.getDate()]).toEqual([9, 2]);
  });
  it("uses the chosen time", () => {
    const d = new Date(presetAt(1, now, "17:30"));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([26, 17, 30]);
  });
  it("falls back to 09:00 for a bad time", () => {
    expect(new Date(presetAt(1, now, "later")).getHours()).toBe(9);
  });
});

describe("presetOf", () => {
  it("finds the preset whose day matches, at any hour", () => {
    expect(presetOf(presetAt(1, now, "17:30"), now)).toBe(1);
    expect(presetOf(presetAt(3, now), now)).toBe(3);
    expect(presetOf(presetAt(7, now, "08:00"), now)).toBe(7);
  });
  it("is null for other days or no date", () => {
    expect(presetOf(dateTimeAt("2026-10-20", "09:00"), now)).toBeNull();
    expect(presetOf(null, now)).toBeNull();
  });
});

describe("dateTimeAt / isoToTimeInput", () => {
  it("combines a picked date and time in local time", () => {
    const d = new Date(dateTimeAt("2026-10-04", "14:15")!);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 4, 14, 15]);
  });
  it("rejects a bad date", () => {
    expect(dateTimeAt("04/10/2026", "09:00")).toBeNull();
  });
  it("round-trips the time of an ISO moment", () => {
    expect(isoToTimeInput(dateTimeAt("2026-10-04", "08:05"))).toBe("08:05");
    expect(isoToTimeInput(null)).toBe("09:00");
  });
});

describe("initials", () => {
  it("takes two letters", () => {
    expect(initials("dana cohen levi")).toBe("DC");
    expect(initials("דנה כהן")).toBe("דכ");
  });
  it("falls back for phone numbers", () => {
    expect(initials("+972 54-123-4567")).toBe("#");
  });
});
