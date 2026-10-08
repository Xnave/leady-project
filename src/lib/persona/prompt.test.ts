import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA, applyPreset } from "./presets";
import { identitySection, personaSection, stripLegacyRole, voiceCraftSection } from "./prompt";

const base = { agentName: "", gender: "neutral" as const, rules: [] };

describe("identitySection", () => {
  it("uses agent name when set, business voice otherwise", () => {
    expect(identitySection({ business: "Golden Kitchens", agentName: "Noa", channel: "whatsapp" })).toMatch(
      /You are Noa from Golden Kitchens/,
    );
    expect(identitySection({ business: "Golden Kitchens", agentName: "", channel: "whatsapp" })).toMatch(
      /You are the team at Golden Kitchens/,
    );
  });

  it("never calls itself 'not a professional' as identity", () => {
    expect(identitySection({ business: "X", agentName: "", channel: "chat" })).not.toMatch(
      /front-desk assistant only/,
    );
  });
});

describe("personaSection", () => {
  it("maps length knobs to concrete limits", () => {
    expect(personaSection(applyPreset("precise_short", base), "en")).toMatch(/1–2 short sentences/);
    expect(personaSection({ ...DEFAULT_PERSONA, length: "detailed" }, "en")).toMatch(/up to ~5 sentences/i);
  });

  it("Hebrew gender lines", () => {
    expect(personaSection({ ...DEFAULT_PERSONA, gender: "female" }, "he")).toMatch(/feminine.*בודקת/);
    expect(personaSection({ ...DEFAULT_PERSONA, gender: "male" }, "he")).toMatch(/masculine.*בודק/);
    expect(personaSection({ ...DEFAULT_PERSONA, gender: "neutral" }, "he")).toMatch(/אנחנו/);
    expect(personaSection(DEFAULT_PERSONA, "he")).toMatch(/don't know the customer's gender/);
  });

  it("no Hebrew grammar lines in English", () => {
    expect(personaSection({ ...DEFAULT_PERSONA, gender: "female" }, "en")).not.toMatch(/בודקת/);
  });

  it("emoji, formality, questions, rules", () => {
    expect(personaSection({ ...DEFAULT_PERSONA, emoji: "none" }, "en")).toMatch(/No emoji/);
    expect(personaSection({ ...DEFAULT_PERSONA, formality: "formal" }, "he")).toMatch(/סבבה/);
    expect(personaSection({ ...DEFAULT_PERSONA, questionStyle: "bundled" }, "en")).toMatch(
      /up to 3 related questions/,
    );
    expect(personaSection({ ...DEFAULT_PERSONA, rules: ["Never discuss competitors"] }, "en")).toMatch(
      /Owner's rules[\s\S]*- Never discuss competitors/,
    );
  });
});

describe("voiceCraftSection", () => {
  it("bans canned openers and asks for one next step", () => {
    const s = voiceCraftSection(DEFAULT_PERSONA);
    expect(s).toMatch(/Great question/);
    expect(s).toMatch(/one clear next step/);
  });
});

describe("stripLegacyRole", () => {
  it("removes onboarding-generated role line, keeps others", () => {
    const sp =
      "Reply in the customer's language.\nYou represent Acme as a front-desk assistant only - not a professional.\nWe open at 9.";
    expect(stripLegacyRole(sp)).toBe("Reply in the customer's language.\nWe open at 9.");
  });
});
