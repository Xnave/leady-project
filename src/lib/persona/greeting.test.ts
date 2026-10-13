import { describe, expect, it } from "vitest";
import type { TurnContext } from "@/lib/flow/types";
import { DEFAULT_PERSONA } from "./presets";
import { greetingOnlyReply, personaGreeting } from "./greeting";

function ctx(o: { intro?: string; lead?: string; agentReplied?: boolean; agentName?: string }): TurnContext {
  return {
    tenant: { name: "מטבחי דמו", phone: "", intro: o.intro ?? "", chatLanguage: "he" },
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

describe("personaGreeting", () => {
  it("introduces the agent and asks how to help when there is no intro", () => {
    expect(personaGreeting(ctx({}), "he")).toBe("היי! אני עדי, העוזרת הדיגיטלית של מטבחי דמו. במה אפשר לעזור?");
  });

  it("uses the owner's intro without a second hello, and keeps its own question", () => {
    expect(personaGreeting(ctx({ intro: "שלום, הגעתם למטבחי דמו. במה אפשר לעזור?" }), "he")).toBe(
      "היי! אני עדי, העוזרת הדיגיטלית של מטבחי דמו. הגעתם למטבחי דמו. במה אפשר לעזור?",
    );
    expect(personaGreeting(ctx({ intro: "אנחנו מתכננים ומתקינים מטבחים." }), "he")).toBe(
      "היי! אני עדי, העוזרת הדיגיטלית של מטבחי דמו. אנחנו מתכננים ומתקינים מטבחים. במה אפשר לעזור?",
    );
  });
});

describe("greetingOnlyReply", () => {
  it("answers a bare first hello with the fixed greeting (no LLM)", () => {
    for (const hello of ["היי", "שלום!", "אהלן", "Hi", "hello"]) {
      expect(greetingOnlyReply(ctx({ lead: hello })), hello).toMatch(/העוזרת הדיגיטלית/);
    }
  });

  it("leaves real questions and later turns to the LLM", () => {
    expect(greetingOnlyReply(ctx({ lead: "היי, כמה עולה מטבח?" }))).toBeUndefined();
    expect(greetingOnlyReply(ctx({ lead: "היי", agentReplied: true }))).toBeUndefined();
  });
});
