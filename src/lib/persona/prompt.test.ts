import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA, applyPreset } from "./presets";
import { firstMessageLine, identitySection, introIntroducesAgent, personaSection, stripLegacyRole, voiceCraftSection } from "./prompt";

const base = { agentName: "", gender: "female" as const, rules: [] };

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
    const he = (agentName: string, gender: "female" | "male") =>
      firstMessageLine({ business: "מטבחי דמו", agentName, gender, intro: "", lang: "he" });
    expect(he("עדי", "female")).toMatch(/אני עדי, העוזרת הדיגיטלית של מטבחי דמו/);
    expect(he("דני", "male")).toMatch(/אני דני, העוזר הדיגיטלי של מטבחי דמו/);
    expect(he("", "female")).toMatch(/כאן העוזרת הדיגיטלית של מטבחי דמו/);
    expect(he("", "male")).toMatch(/כאן העוזר הדיגיטלי של מטבחי דמו/);
    for (const line of [he("עדי", "female"), he("", "male")]) {
      expect(line).not.toMatch(/\(AI\)|מבוסס AI/);
      expect(line).toMatch(/don't add "AI"/);
    }
    expect(
      firstMessageLine({ business: "Acme", agentName: "Noa", gender: "female", intro: "", lang: "en" }),
    ).toMatch(/I'm Noa, Acme's AI assistant/);
  });

  it("detects an intro that already introduces the agent", () => {
    expect(introIntroducesAgent("היי! אני בקי, העוזרת הווירטואלית של Taxtica")).toBe(true);
    expect(introIntroducesAgent("שלום, כאן נועה מהצוות")).toBe(true);
    expect(introIntroducesAgent("Hi! I'm Becky from X.")).toBe(true);
    expect(introIntroducesAgent("אנחנו מתכננים ומתקינים מטבחים.")).toBe(false);
    expect(introIntroducesAgent("Welcome to X, we build kitchens.")).toBe(false);
  });

  it("with an intro that doesn't introduce, still says who it is and uses the intro as background", () => {
    const s = firstMessageLine({ business: "X", agentName: "", gender: "female", intro: "Welcome to X!", lang: "en" });
    expect(s).toMatch(/AI assistant/);
    expect(s).toMatch(/background[^\n]*Welcome to X!/);
  });

  it("with an owner opening, starts from it and never introduces itself twice", () => {
    const s = firstMessageLine({ business: "X", agentName: "Tamar", gender: "female", intro: "Hi! I'm Becky from X.", lang: "en" });
    expect(s).toMatch(/Hi! I'm Becky from X\./);
    expect(s).toMatch(/don't add a second introduction/i);
    expect(s).not.toMatch(/I'm Tamar, X's AI assistant/);
    expect(s).toMatch(/do not ask how you can help/i);
  });
});

describe("personaSection", () => {
  it("maps length knobs to concrete limits; auto adds no length rule", () => {
    expect(personaSection(applyPreset("precise_short", base), "en")).toMatch(/1–2 short sentences/);
    expect(personaSection({ ...DEFAULT_PERSONA, length: "medium" }, "en")).toMatch(/2–3 sentences/);
    expect(personaSection({ ...DEFAULT_PERSONA, length: "auto" }, "en")).not.toMatch(/Length:/);
  });

  it("Hebrew gender lines", () => {
    expect(personaSection({ ...DEFAULT_PERSONA, gender: "female" }, "he")).toMatch(/feminine.*בודקת/);
    expect(personaSection({ ...DEFAULT_PERSONA, gender: "male" }, "he")).toMatch(/masculine.*בודק/);
    expect(personaSection(DEFAULT_PERSONA, "he")).toMatch(/don't know the customer's gender/);
    expect(personaSection(DEFAULT_PERSONA, "he")).toMatch(/addresses you .* says nothing about their own gender/);
  });

  it("no Hebrew grammar lines in English", () => {
    expect(personaSection({ ...DEFAULT_PERSONA, gender: "female" }, "en")).not.toMatch(/בודקת/);
  });

  it("formal gives examples of the register; casual lists what to avoid", () => {
    const formal = personaSection({ ...DEFAULT_PERSONA, formality: "formal" }, "he");
    expect(formal).toMatch(/תודה על פנייתך/);
    expect(formal).not.toMatch(/avoid/i);
    const casual = personaSection({ ...DEFAULT_PERSONA, formality: "casual" }, "he");
    expect(casual).toMatch(/avoid[^\n]*הנכם/i);
  });

  it("emoji and owner rules; no question-style knob", () => {
    expect(personaSection({ ...DEFAULT_PERSONA, emoji: "none" }, "en")).toMatch(/No emoji/);
    expect(personaSection(DEFAULT_PERSONA, "en")).not.toMatch(/Questions:/);
    expect(personaSection({ ...DEFAULT_PERSONA, rules: ["Never discuss competitors"] }, "en")).toMatch(
      /Owner's rules[\s\S]*- Never discuss competitors/,
    );
    expect(personaSection({ ...DEFAULT_PERSONA, rules: ["x"] }, "en")).toMatch(/when it fits the moment/);
  });
});

describe("voiceCraftSection", () => {
  it("is about how replies sound, not what the conversation does next", () => {
    const s = voiceCraftSection();
    expect(s).toMatch(/Great question/);
    expect(s).toMatch(/no headings/);
    expect(s).not.toMatch(/next step/);
    expect(s).not.toMatch(/meeting/);
    expect(s).not.toMatch(/short paragraphs/);
    expect(s).not.toMatch(/knowledge doesn't cover/);
  });
});

describe("stripLegacyRole", () => {
  it("removes onboarding-generated role line, keeps others", () => {
    const sp =
      "Reply in the customer's language.\nYou represent Acme as a front-desk assistant only - not a professional.\nWe open at 9.";
    expect(stripLegacyRole(sp)).toBe("Reply in the customer's language.\nWe open at 9.");
  });
});
