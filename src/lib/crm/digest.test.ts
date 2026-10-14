import { describe, expect, it } from "vitest";
import {
  FULL_TEXT_MAX_ITEMS,
  buildDigest,
  digestDelivery,
  digestFullText,
  localDateAndHour,
  parseOwnerCommand,
  pendingRecipients,
  phoneDigits,
  sanitizeTemplateParam,
  serviceWindowOpen,
} from "./digest";

const at = new Date("2026-09-25T05:00:00Z");
const item = (reason: "handoff" | "approval" | "reminder" | "cold", name = "Dana", stand = "Villa · 12–15/10") => ({
  leadId: name, name, reason, stand, at,
});

describe("buildDigest", () => {
  it("returns null with nothing due", () => {
    expect(buildDigest([])).toBeNull();
  });
  it("counts reasons and picks the most urgent top item", () => {
    const d = buildDigest([item("cold", "A"), item("approval", "B"), item("cold", "C")])!;
    expect(d.total).toBe(3);
    expect(d.counts).toEqual({ handoff: 0, approval: 1, reminder: 0, cold: 2 });
    expect(d.top.name).toBe("B");
  });
});

describe("sanitizeTemplateParam", () => {
  it("strips line breaks, tabs and runs of spaces", () => {
    const v = sanitizeTemplateParam("a\t\tb     c\nd");
    expect(v).toBe("a b c d");
  });
  it("never sends an empty param", () => {
    expect(sanitizeTemplateParam("   ")).toBe("-");
  });
  it("truncates by code point, never splitting emoji", () => {
    const result = sanitizeTemplateParam("a".repeat(38) + "😀" + "z", 40);
    // No lone surrogates
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    // At most 40 code points (including trailing …)
    expect(Array.from(result).length).toBeLessThanOrEqual(40);
  });
});

describe("digestFullText", () => {
  it("lists every item with its reason and a link", () => {
    const text = digestFullText([item("approval", "Dana"), item("cold", "Ori")], { handoff: "H", approval: "Needs approval", reminder: "R", cold: "Gone cold" }, "https://app.example");
    expect(text).toContain("Dana · Needs approval");
    expect(text).toContain("Ori · Gone cold");
    expect(text).toContain("https://app.example/leads?tab=needs");
  });
});

describe("localDateAndHour", () => {
  it("uses the tenant timezone", () => {
    expect(localDateAndHour(new Date("2026-09-25T05:30:00Z"), "Asia/Jerusalem")).toEqual({ date: "2026-09-25", hour: 8 });
    expect(localDateAndHour(new Date("2026-09-24T22:30:00Z"), "Asia/Jerusalem")).toEqual({ date: "2026-09-25", hour: 1 });
  });
});

describe("pendingRecipients", () => {
  const all = [{ clerkUserId: "a" }, { clerkUserId: "b" }, { clerkUserId: "c" }];

  it("returns everyone when nothing has been sent", () => {
    expect(pendingRecipients(all, [])).toEqual(all);
  });
  it("excludes recipients already in the sent list", () => {
    expect(pendingRecipients(all, ["b"])).toEqual([{ clerkUserId: "a" }, { clerkUserId: "c" }]);
  });
  it("returns empty once everyone is in the sent list", () => {
    expect(pendingRecipients(all, ["a", "b", "c"])).toEqual([]);
  });
  it("ignores sent ids that aren't in the recipient list", () => {
    expect(pendingRecipients(all, ["z"])).toEqual(all);
  });
});

describe("digestFullText cap", () => {
  it("lists at most FULL_TEXT_MAX_ITEMS lines and counts the rest", () => {
    const many = Array.from({ length: FULL_TEXT_MAX_ITEMS + 5 }, (_, i) => item("cold", `L${i}`));
    const text = digestFullText(many, { handoff: "H", approval: "A", reminder: "R", cold: "C" }, "https://x");
    expect(text.split("\n").filter((l) => l.startsWith("•"))).toHaveLength(FULL_TEXT_MAX_ITEMS);
    expect(text).toContain("+5");
  });
});

describe("service window", () => {
  const now = new Date("2026-10-14T08:00:00Z");
  it("is open for 24h after the owner's last message", () => {
    expect(serviceWindowOpen(new Date("2026-10-13T08:30:00Z"), now)).toBe(true);
    expect(serviceWindowOpen(new Date("2026-10-13T07:59:00Z"), now)).toBe(false);
    expect(serviceWindowOpen(null, now)).toBe(false);
  });
});

describe("digestDelivery", () => {
  it("prefers free text in an open window, then the template, else waits", () => {
    expect(digestDelivery({ windowOpen: true, hasConversation: true, hasTemplate: true })).toBe("text");
    expect(digestDelivery({ windowOpen: true, hasConversation: false, hasTemplate: true })).toBe("template");
    expect(digestDelivery({ windowOpen: false, hasConversation: true, hasTemplate: true })).toBe("template");
    expect(digestDelivery({ windowOpen: false, hasConversation: true, hasTemplate: false })).toBe("wait");
  });
});

describe("parseOwnerCommand", () => {
  it("reads opt-in codes in English and Hebrew", () => {
    expect(parseOwnerCommand(" START 123456 ")).toEqual({ kind: "start", code: "123456" });
    expect(parseOwnerCommand("start123456")).toEqual({ kind: "start", code: "123456" });
    expect(parseOwnerCommand("הפעל 654321")).toEqual({ kind: "start", code: "654321" });
    expect(parseOwnerCommand("START 12345")).toEqual({ kind: "other" });
  });
  it("reads unsubscribe words", () => {
    for (const w of ["STOP", "stop", "הסר", "עצור"]) expect(parseOwnerCommand(w)).toEqual({ kind: "stop" });
  });
  it("treats anything else, including the button, as a full-list request", () => {
    expect(parseOwnerCommand("הצג רשימה מלאה")).toEqual({ kind: "other" });
    expect(parseOwnerCommand("")).toEqual({ kind: "other" });
  });
});

describe("phoneDigits", () => {
  it("keeps digits only", () => {
    expect(phoneDigits("+972 50-123-4567")).toBe("972501234567");
  });
});
