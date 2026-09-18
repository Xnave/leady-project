import { describe, expect, it } from "vitest";
import { isMeetingStillRelevant } from "./meeting-relevance";

describe("isMeetingStillRelevant", () => {
  const now = new Date("2026-09-18T10:00:00");

  it("keeps pending meetings relevant", () => {
    expect(
      isMeetingStillRelevant(
        { status: "pending", slotText: "10 בספטמבר 2026 בשעה 14:00" },
        now,
      ),
    ).toBe(true);
  });

  it("drops rejected meetings", () => {
    expect(
      isMeetingStillRelevant(
        { status: "rejected", slotText: "20 בספטמבר 2026 בשעה 14:00" },
        now,
      ),
    ).toBe(false);
  });

  it("keeps approved meetings through end of slot day", () => {
    expect(
      isMeetingStillRelevant(
        {
          status: "approved",
          slotText: "18 בספטמבר 2026 בשעה 08:00",
          decidedAt: "2026-09-14T12:00:00Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("drops approved meetings whose slot day has passed", () => {
    expect(
      isMeetingStillRelevant(
        {
          status: "approved",
          slotText: "10 בספטמבר 2026 בשעה 14:00",
          decidedAt: "2026-09-09T12:00:00Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("uses decidedAt fallback when slot has no parseable date", () => {
    expect(
      isMeetingStillRelevant(
        {
          status: "approved",
          slotText: "מתישהו בבוקר",
          decidedAt: "2026-09-17T12:00:00Z",
        },
        now,
      ),
    ).toBe(true);
    expect(
      isMeetingStillRelevant(
        {
          status: "approved",
          slotText: "מתישהו בבוקר",
          decidedAt: "2026-09-10T12:00:00Z",
        },
        now,
      ),
    ).toBe(false);
  });
});
