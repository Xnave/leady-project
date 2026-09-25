import { describe, expect, it } from "vitest";
import { initials, presetAt, relTime, untilTime } from "./format";

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
