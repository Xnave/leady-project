import { describe, expect, it } from "vitest";
import { buildDigest, digestFullText, digestTemplateParams, localDateAndHour, sanitizeTemplateParam } from "./digest";

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

describe("digestTemplateParams", () => {
  it("produces 7 params in template order", () => {
    const d = buildDigest([item("handoff", "Yossi", "Group of 12"), item("cold", "Ori")])!;
    expect(digestTemplateParams(d, "Snir")).toEqual(["Snir", "2", "0", "1", "0", "1", "Yossi · Group of 12"]);
  });
  it("strips line breaks, tabs and runs of spaces, and truncates", () => {
    const d = buildDigest([item("handoff", "Dana\nCohen", "a\t\tb     c " + "x".repeat(200))])!;
    const p = digestTemplateParams(d, "  Snir  ");
    for (const v of p) {
      expect(v).not.toMatch(/[\n\t]/);
      expect(v).not.toMatch(/ {4,}/);
    }
    expect(p[0]).toBe("Snir");
    expect(p[6].length).toBeLessThanOrEqual(80);
  });
  it("never sends an empty param", () => {
    expect(sanitizeTemplateParam("   ")).toBe("-");
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
