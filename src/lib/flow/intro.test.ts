import { describe, expect, it } from "vitest";
import { cannedIntroText, isIdleConversationReset, shouldSendCannedIntro } from "./intro";
import { flowForCatalog } from "./catalog";
import type { TurnContext } from "./types";
import { defaultHitlPolicy, defaultLeadSchema } from "./validate";

function ctx(extra?: Partial<TurnContext>): TurnContext {
  return {
    tenantId: "t1",
    tenant: {
      name: "מטבחי הזהב",
      phone: "",
      intro: "שלום ברוך הבא למטבחי הזהב.",
      chatLanguage: "he",
      idleResetDays: 5,
    },
    agent: {
      id: "a1",
      tenantId: "t1",
      systemPrompt: "",
      knowledgeText: "",
      flow: flowForCatalog("inbox"),
      flowVersion: 1,
      leadSchema: defaultLeadSchema,
      hitlPolicy: defaultHitlPolicy,
    },
    conversation: {
      id: "c1",
      status: "open",
      flowState: "talk",
      flowVersion: 1,
      nudgeCountByStage: {},
    },
    lead: { id: "l1", externalUserId: "+1", fields: {} },
    messages: [{ role: "lead", text: "שלום" }],
    ...extra,
  };
}

describe("canned intro", () => {
  it("uses the onboard intro verbatim", () => {
    expect(cannedIntroText(ctx())).toBe("שלום ברוך הבא למטבחי הזהב.");
  });

  it("is required on the first customer message", () => {
    expect(shouldSendCannedIntro(ctx())).toBe(true);
  });

  it("is not required on the next message after the intro", () => {
    expect(
      shouldSendCannedIntro(
        ctx({
          messages: [
            { role: "lead", text: "שלום" },
            { role: "agent", text: "שלום ברוך הבא למטבחי הזהב." },
            { role: "lead", text: "אני רוצה מטבח" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("detects idle of 5 days", () => {
    expect(
      isIdleConversationReset(
        ctx({
          messages: [
            {
              role: "lead",
              text: "hi",
              createdAt: new Date("2026-08-20T10:00:00Z"),
            },
            {
              role: "agent",
              text: "intro",
              createdAt: new Date("2026-08-20T10:00:01Z"),
            },
            {
              role: "lead",
              text: "back",
              createdAt: new Date("2026-08-26T10:00:00Z"),
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
