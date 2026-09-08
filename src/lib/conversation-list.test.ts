import { describe, expect, it } from "vitest";
import {
  avatarInitials,
  dayHeading,
  dayKey,
  groupByDay,
  messagePreview,
  rowState,
  rowTime,
} from "./conversation-list";
import { uiCopy } from "./ui";

const ui = uiCopy("en");
const NOW = new Date("2026-09-07T14:30:00");

describe("groupByDay", () => {
  it("buckets a newest-first list into newest-first day groups", () => {
    const rows = [
      { at: new Date("2026-09-07T11:00:00") },
      { at: new Date("2026-09-07T09:00:00") },
      { at: new Date("2026-09-05T18:00:00") },
    ];
    const groups = groupByDay(rows, (r) => r.at);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-07", "2026-09-05"]);
    expect(groups[0].items).toHaveLength(2);
  });

  it("returns no groups for an empty list", () => {
    expect(groupByDay([], () => NOW)).toEqual([]);
  });

  it("keys on the local calendar day, not UTC", () => {
    expect(dayKey(new Date("2026-09-07T23:30:00"))).toBe("2026-09-07");
  });
});

describe("dayHeading", () => {
  it("prefers today and yesterday over a date", () => {
    expect(dayHeading(new Date("2026-09-07T08:00:00"), ui, "en", NOW)).toBe("Today");
    expect(dayHeading(new Date("2026-09-06T08:00:00"), ui, "en", NOW)).toBe("Yesterday");
  });

  it("spells out older days without repeating the current year", () => {
    const heading = dayHeading(new Date("2026-09-01T08:00:00"), ui, "en", NOW);
    expect(heading).toContain("September");
    expect(heading).not.toContain("2026");
  });
});

describe("rowTime", () => {
  it("shows a clock for today and a date for anything older", () => {
    expect(rowTime(new Date("2026-09-07T09:05:00"), "en", NOW)).toMatch(/09:05/);
    expect(rowTime(new Date("2026-09-01T09:05:00"), "en", NOW)).toMatch(/Sep/);
  });
});

describe("rowState", () => {
  it("treats a paused conversation or a pending visit as needing the owner", () => {
    expect(
      rowState({ convoStatus: "waiting_human", pendingMeetings: 0, leadStatus: "open" }),
    ).toBe("needs_you");
    expect(rowState({ convoStatus: "open", pendingMeetings: 1, leadStatus: "open" })).toBe(
      "needs_you",
    );
  });

  it("quiets decided leads and closed conversations", () => {
    expect(rowState({ convoStatus: "open", pendingMeetings: 0, leadStatus: "won" })).toBe("quiet");
    expect(rowState({ convoStatus: "closed", pendingMeetings: 0, leadStatus: "open" })).toBe(
      "quiet",
    );
  });

  it("calls everything else active", () => {
    expect(rowState({ convoStatus: "open", pendingMeetings: 0, leadStatus: "open" })).toBe(
      "active",
    );
  });
});

describe("messagePreview", () => {
  it("names the speaker and collapses whitespace", () => {
    expect(messagePreview({ role: "lead", text: " hi\n  there " }, ui)).toBe("Customer: hi there");
  });

  it("clips a long message to one line", () => {
    const preview = messagePreview({ role: "agent", text: "x".repeat(200) }, ui);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThan(110);
  });

  it("invites the first message when there is none", () => {
    expect(messagePreview(undefined, ui)).toBe(ui.conversations.noMessages);
  });
});

describe("avatarInitials", () => {
  it("uses the first letter of the first two words", () => {
    expect(avatarInitials("Dana Cohen")).toBe("DC");
    expect(avatarInitials("דנה כהן")).toBe("דכ");
  });

  it("falls back to the first two characters of a single token", () => {
    expect(avatarInitials("@studio_tlv")).toBe("ST");
  });

  it("never returns an empty label", () => {
    expect(avatarInitials("   ")).toBe("?");
  });
});
