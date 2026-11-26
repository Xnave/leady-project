import { describe, expect, it } from "vitest";
import { deriveStartedAt, parseClientDate, type StartedAtStep } from "./dates";

describe("parseClientDate", () => {
  it("reads DD/MM/YYYY with or without a time, and ISO", () => {
    expect(parseClientDate("05/03/2019")?.toISOString()).toBe("2019-03-05T00:00:00.000Z");
    expect(parseClientDate("05/03/2019 14:20")?.toISOString()).toBe("2019-03-05T00:00:00.000Z");
    expect(parseClientDate("2019-03-05")?.toISOString()).toBe("2019-03-05T00:00:00.000Z");
    expect(parseClientDate("2019-03-05T10:00:00Z")?.toISOString()).toBe("2019-03-05T00:00:00.000Z");
  });

  it("treats zero, empty and impossible dates as missing", () => {
    for (const v of ["", "0000-00-00", "00/00/0000", "31/02/2019", "13/13/2019", "nope", null, 12]) {
      expect(parseClientDate(v)).toBeNull();
    }
  });
});

describe("deriveStartedAt", () => {
  const steps: StartedAtStep[] = [
    { field: "exec", offsetMonths: 0, confidence: "high" },
    { field: "archived_at", offsetMonths: 0, confidence: "medium_high", whenField: "status", whenIn: ["7"] },
    { field: "contract", offsetMonths: 3, confidence: "medium" },
  ];

  it("takes the first rung with a date", () => {
    const d = deriveStartedAt({ exec: "01/06/2018", contract: "01/01/2018" }, steps);
    expect(d).toEqual({ date: new Date("2018-06-01T00:00:00Z"), source: "exec", confidence: "high" });
  });

  it("adds the rung's month offset", () => {
    const d = deriveStartedAt({ contract: "15/11/2017" }, steps);
    expect(d.date?.toISOString()).toBe("2018-02-15T00:00:00.000Z");
    expect(d.source).toBe("contract");
    expect(d.confidence).toBe("medium");
  });

  it("uses a gated rung only when the gate field matches", () => {
    expect(deriveStartedAt({ archived_at: "01/01/2019", status: "7" }, steps).source).toBe("archived_at");
    expect(deriveStartedAt({ archived_at: "01/01/2019", status: "3" }, steps).source).toBe("");
  });

  it("never matches a gated rung with an empty allow-list", () => {
    const gated: StartedAtStep[] = [{ field: "a", offsetMonths: 0, confidence: "high", whenField: "s", whenIn: [] }];
    expect(deriveStartedAt({ a: "01/01/2019", s: "" }, gated).date).toBeNull();
  });

  it("returns an empty result when nothing matches", () => {
    expect(deriveStartedAt({}, steps)).toEqual({ date: null, source: "", confidence: "" });
  });
});
