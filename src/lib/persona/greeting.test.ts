import { describe, expect, it } from "vitest";
import type { TurnContext } from "@/lib/flow/types";
import { DEFAULT_PERSONA } from "./presets";
import { greetingOnlyReply, openingLine, personaGreeting, withFirstMessageIntro } from "./greeting";

const TAXTICA = "היי! אני בקי, העוזרת הווירטואלית של Taxtica - החזרי מס.\nאיך אוכל לעזור לך לפגוש את הכסף שמגיע לך?";

function ctx(o: { intro?: string; lead?: string; agentReplied?: boolean; agentName?: string; name?: string }): TurnContext {
  return {
    tenant: { name: o.name ?? "מטבחי דמו", phone: "", intro: o.intro ?? "", chatLanguage: "multi" },
    agent: { persona: { ...DEFAULT_PERSONA, agentName: o.agentName ?? "עדי" } },
    channel: { provider: "whatsapp" },
    conversation: { id: "c", status: "open", flowState: "talk", flowVersion: 1, nudgeCountByStage: {} },
    lead: { id: "l", externalUserId: "u", fields: {} },
    messages: [
      ...(o.agentReplied ? [{ role: "agent", text: "היי" }] : []),
      { role: "lead", text: o.lead ?? "היי" },
    ],
  } as unknown as TurnContext;
}

describe("personaGreeting (bare first hello, no LLM)", () => {
  it("introduces the agent and asks how to help when there is no intro", () => {
    expect(personaGreeting(ctx({}), "he")).toBe("היי! אני עדי, העוזרת הדיגיטלית של מטבחי דמו. במה אפשר לעזור?");
  });

  it("uses an owner opening that already introduces the agent exactly as written", () => {
    expect(personaGreeting(ctx({ intro: TAXTICA, name: "Taxtica" }), "he")).toBe(TAXTICA);
  });

  it("adds the agent line before an intro that doesn't introduce anyone, without a second hello", () => {
    expect(personaGreeting(ctx({ intro: "שלום, אנחנו מתכננים ומתקינים מטבחים." }), "he")).toBe(
      "היי! אני עדי, העוזרת הדיגיטלית של מטבחי דמו. אנחנו מתכננים ומתקינים מטבחים. במה אפשר לעזור?",
    );
  });

  it("drops an intro sentence that only welcomes to the business the agent line already names", () => {
    expect(personaGreeting(ctx({ intro: "שלום, הגעתם למטבחי דמו. במה אפשר לעזור?" }), "he")).toBe(
      "היי! אני עדי, העוזרת הדיגיטלית של מטבחי דמו. במה אפשר לעזור?",
    );
  });

  it("ignores a Hebrew intro for an English-speaking customer", () => {
    expect(personaGreeting(ctx({ intro: TAXTICA, agentName: "Becky", name: "Taxtica" }), "en")).toBe(
      "Hi! I'm Becky, Taxtica's AI assistant. How can I help?",
    );
  });
});

describe("openingLine (the one introduction on an LLM first reply)", () => {
  it("is the introducing sentence of the owner's opening, without its question", () => {
    expect(openingLine(ctx({ intro: TAXTICA, name: "Taxtica" }), "he")).toBe(
      "היי! אני בקי, העוזרת הווירטואלית של Taxtica - החזרי מס.",
    );
  });

  it("is the persona line when the intro doesn't introduce the agent", () => {
    expect(openingLine(ctx({ intro: "שלום, הגעתם למטבחי דמו. במה אפשר לעזור?" }), "he")).toBe(
      "היי! אני עדי, העוזרת הדיגיטלית של מטבחי דמו.",
    );
  });
});

describe("withFirstMessageIntro", () => {
  it("puts the single introduction in front of the first reply only", () => {
    const first = ctx({ intro: TAXTICA, name: "Taxtica", lead: "מגיע לי החזר?" });
    expect(withFirstMessageIntro(first, "he", "כנראה שכן, באיזו שנה מדובר?")).toBe(
      "היי! אני בקי, העוזרת הווירטואלית של Taxtica - החזרי מס. כנראה שכן, באיזו שנה מדובר?",
    );
    const later = ctx({ intro: TAXTICA, name: "Taxtica", agentReplied: true });
    expect(withFirstMessageIntro(later, "he", "כנראה שכן.")).toBe("כנראה שכן.");
  });

  it("drops a hello the model put at the start of its answer", () => {
    const first = ctx({ intro: TAXTICA, name: "Taxtica", lead: "מגיע לי החזר?" });
    expect(withFirstMessageIntro(first, "he", "הי! כנראה שכן.")).toBe(
      "היי! אני בקי, העוזרת הווירטואלית של Taxtica - החזרי מס. כנראה שכן.",
    );
  });

  it("doesn't double it when the model already started with it, and leaves empty replies alone", () => {
    const first = ctx({ intro: TAXTICA, name: "Taxtica", lead: "מגיע לי החזר?" });
    const already = "היי! אני בקי, העוזרת הווירטואלית של Taxtica - החזרי מס. כנראה שכן.";
    expect(withFirstMessageIntro(first, "he", already)).toBe(already);
    expect(withFirstMessageIntro(first, "he", "")).toBe("");
  });
});

describe("greetingOnlyReply", () => {
  it("answers a bare first hello with the fixed greeting (no LLM)", () => {
    for (const hello of ["היי", "שלום!", "אהלן", "Hi", "hello"]) {
      expect(greetingOnlyReply(ctx({ lead: hello })), hello).toMatch(/העוזרת הדיגיטלית|AI assistant/);
    }
  });

  it("leaves real questions and later turns to the LLM", () => {
    expect(greetingOnlyReply(ctx({ lead: "היי, כמה עולה מטבח?" }))).toBeUndefined();
    expect(greetingOnlyReply(ctx({ lead: "היי", agentReplied: true }))).toBeUndefined();
  });
});
