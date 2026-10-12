import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA, applyPreset } from "./presets";
import { firstMessageLine, identitySection, personaSection, stripLegacyRole, voiceCraftSection } from "./prompt";

const base = { agentName: "", gender: "neutral" as const, rules: [] };

describe("identitySection", () => {
  it("uses agent name when set, business voice otherwise", () => {
    expect(identitySection({ business: "Golden Kitchens", agentName: "Noa", channel: "whatsapp" })).toMatch(
      /You are Noa, the AI assistant of Golden Kitchens/,
    );
    expect(identitySection({ business: "Golden Kitchens", agentName: "", channel: "whatsapp" })).toMatch(
      /You are the AI assistant of Golden Kitchens/,
    );
  });

  it("never calls itself 'not a professional' as identity", () => {
    expect(identitySection({ business: "X", agentName: "", channel: "chat" })).not.toMatch(
      /front-desk assistant only/,
    );
  });
});

describe("AI disclosure", () => {
  it("identity says it is an AI and never claims to be human", () => {
    const s = identitySection({ business: "X", agentName: "Noa", channel: "chat" });
    expect(s).toMatch(/AI assistant/);
    expect(s).toMatch(/never claim or imply you are human/i);
    expect(identitySection({ business: "X", agentName: "", channel: "chat" })).not.toMatch(/not as a bot/);
  });

  it("first message introduces the agent as an AI, matching name and gender", () => {
    const he = (agentName: string, gender: "female" | "male" | "neutral") =>
      firstMessageLine({ business: "מטבחי דמו", agentName, gender, intro: "", lang: "he" });
    expect(he("עדי", "female")).toMatch(/אני עדי, העוזרת הדיגיטלית של מטבחי דמו/);
    expect(he("דני", "male")).toMatch(/אני דני, העוזר הדיגיטלי של מטבחי דמו/);
    expect(he("", "neutral")).toMatch(/AI/);
    expect(
      firstMessageLine({ business: "Acme", agentName: "Noa", gender: "female", intro: "", lang: "en" }),
    ).toMatch(/I'm Noa, Acme's AI assistant/);
  });

  it("first message uses the intro only as background and answers a real question", () => {
    const s = firstMessageLine({ business: "X", agentName: "", gender: "neutral", intro: "Welcome to X!", lang: "en" });
    expect(s).toMatch(/background/);
    expect(s).toMatch(/Welcome to X!/);
    expect(s).toMatch(/do not ask how you can help/i);
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
    expect(personaSection(DEFAULT_PERSONA, "he")).toMatch(/addresses you .* says nothing about their own gender/);
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
    expect(personaSection({ ...DEFAULT_PERSONA, rules: ["x"] }, "en")).toMatch(/when it fits the moment/);
  });
});

describe("voiceCraftSection", () => {
  it("bans canned openers and asks for one next step", () => {
    const s = voiceCraftSection(DEFAULT_PERSONA);
    expect(s).toMatch(/Great question/);
    expect(s).toMatch(/one clear next step/);
  });

  it("does not push a meeting in every reply", () => {
    expect(voiceCraftSection(DEFAULT_PERSONA)).toMatch(/Suggest a meeting at most once/);
  });
});

describe("stripLegacyRole", () => {
  it("removes onboarding-generated role line, keeps others", () => {
    const sp =
      "Reply in the customer's language.\nYou represent Acme as a front-desk assistant only - not a professional.\nWe open at 9.";
    expect(stripLegacyRole(sp)).toBe("Reply in the customer's language.\nWe open at 9.");
  });
});
