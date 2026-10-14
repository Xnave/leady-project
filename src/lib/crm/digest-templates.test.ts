import { describe, expect, it } from "vitest";
import { buildDigest } from "./digest";
import {
  DIGEST_SECTORS,
  DIGEST_TEMPLATES,
  digestTemplateParams,
  pickDigestTemplate,
  resolveDigestSector,
  templateCreateBody,
  templateKey,
} from "./digest-templates";

const at = new Date("2026-10-14T05:00:00Z");
const item = (reason: "handoff" | "approval" | "reminder" | "cold", name: string, stand = "12-14/11") => ({
  leadId: name, name, reason, stand, at,
});

describe("digest template catalog (what Meta reviews)", () => {
  for (const sector of DIGEST_SECTORS) {
    const t = DIGEST_TEMPLATES[sector];
    it(`${sector}: valid name, numbered variables, an example for each`, () => {
      expect(t.sector).toBe(sector);
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(vars).toEqual([1, 2, 3, 4, 5]);
      expect(t.example).toHaveLength(vars.length);
      for (const ex of t.example) expect(ex).not.toMatch(/[\n\t]/);
    });
    it(`${sector}: body neither starts nor ends with a variable`, () => {
      expect(t.body.trim()).not.toMatch(/^\{\{\d+\}\}/);
      expect(t.body.trim()).not.toMatch(/\{\{\d+\}\}$/);
    });
    it(`${sector}: fits Meta's limits (body 1024, footer 60, button 25)`, () => {
      expect(t.body.length).toBeLessThanOrEqual(1024);
      expect(t.footer.length).toBeLessThanOrEqual(60);
      expect(t.button.length).toBeLessThanOrEqual(25);
    });
  }

  it("uses a distinct name per sector", () => {
    const names = DIGEST_SECTORS.map((s) => DIGEST_TEMPLATES[s].name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("builds Zernio's create body with body, footer and quick-reply button", () => {
    const body = templateCreateBody(DIGEST_TEMPLATES.hospitality, "acc1");
    expect(body).toMatchObject({ accountId: "acc1", name: "zapidly_digest_hospitality_v1", category: "UTILITY", language: "he" });
    expect(body.components[0]).toMatchObject({ type: "BODY", example: { body_text: [DIGEST_TEMPLATES.hospitality.example] } });
    expect(body.components[2]).toEqual({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "הצג רשימה מלאה" }] });
  });
});

describe("digestTemplateParams", () => {
  it("produces 5 params: name, approvals, handoffs, follow-ups, most urgent", () => {
    const d = buildDigest([item("cold", "Ori"), item("approval", "Yossi", "Villa · 2 nights"), item("reminder", "Dana"), item("handoff", "Avi")])!;
    expect(digestTemplateParams(d, "Snir")).toEqual(["Snir", "1", "1", "2", "Avi · 12-14/11"]);
  });
  it("cleans params for Meta", () => {
    const d = buildDigest([item("approval", "Dana\nCohen", "a\t\tb " + "x".repeat(200))])!;
    const p = digestTemplateParams(d, "  Snir  ");
    expect(p[0]).toBe("Snir");
    expect(p[4]).not.toMatch(/[\n\t]/);
    expect(Array.from(p[4]).length).toBeLessThanOrEqual(80);
  });
});

describe("resolveDigestSector", () => {
  it("honours an explicit choice", () => {
    expect(resolveDigestSector("appointments", [{ capabilityId: "reservations", enabled: true }])).toBe("appointments");
  });
  it("infers hospitality from an enabled reservations instance", () => {
    expect(resolveDigestSector("", [{ capabilityId: "reservations", enabled: true }])).toBe("hospitality");
    expect(resolveDigestSector("", [{ capabilityId: "reservations", enabled: false }])).toBe("general");
  });
  it("does not infer a sector from the default booking instance", () => {
    expect(resolveDigestSector("", [{ capabilityId: "booking", enabled: true }])).toBe("general");
  });
  it("ignores an unknown stored value", () => {
    expect(resolveDigestSector("bakery", [])).toBe("general");
  });
});

describe("pickDigestTemplate", () => {
  const key = (s: keyof typeof DIGEST_TEMPLATES) => templateKey(DIGEST_TEMPLATES[s].name, "he");
  it("uses the sector's template once approved", () => {
    expect(pickDigestTemplate("hospitality", new Set([key("hospitality"), key("general")]))?.sector).toBe("hospitality");
  });
  it("falls back to the general template while the sector's is pending", () => {
    expect(pickDigestTemplate("hospitality", new Set([key("general")]))?.sector).toBe("general");
  });
  it("returns null when nothing is approved", () => {
    expect(pickDigestTemplate("appointments", new Set())).toBeNull();
  });
});
