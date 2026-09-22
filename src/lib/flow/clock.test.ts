import { describe, expect, it } from "vitest";
import {
  askedToStartNewConversation,
  canCallStartNewConversation,
  looksLikeShortAffirmation,
} from "./affirm";
import { calendarClockLine, todayIsoDate, zonedToday } from "./clock";
import type { TurnContext } from "./types";
import { defaultFlow, defaultHitlPolicy, defaultLeadSchema } from "./validate";

describe("clock", () => {
  it("formats a Jerusalem civil date", () => {
    const sat = new Date("2026-09-19T10:00:00+03:00");
    expect(todayIsoDate(sat)).toBe("2026-09-19");
    const line = calendarClockLine(sat);
    expect(line).toMatch(/Saturday/);
    expect(line).toMatch(/19 September 2026/);
    expect(line).toMatch(/Asia\/Jerusalem/);
    expect(zonedToday(sat).getDate()).toBe(19);
  });
});

describe("affirm / start_new_conversation gate", () => {
  it("treats כן and טוב as short affirmations but not frustration", () => {
    expect(looksLikeShortAffirmation("כן")).toBe(true);
    expect(looksLikeShortAffirmation("טוב")).toBe(true);
    expect(looksLikeShortAffirmation("כבר אמרתי לך")).toBe(false);
  });

  it("only allows a new thread after yes to an explicit reset ask", () => {
    expect(askedToStartNewConversation("Want to start a new conversation?")).toBe(
      true,
    );
    const flow = defaultFlow();
    const base: TurnContext = {
      tenantId: "t1",
      tenant: { name: "X", phone: "", intro: "", chatLanguage: "he" },
      agent: {
        id: "a1",
        tenantId: "t1",
        systemPrompt: "",
        knowledgeText: "",
        flow,
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
      messages: [{ role: "lead", text: "כבר אמרתי לך" }],
    };
    expect(canCallStartNewConversation(base)).toBe(false);

    const agreed: TurnContext = {
      ...base,
      messages: [
        { role: "agent", text: "Want to start a new conversation?" },
        { role: "lead", text: "כן" },
      ],
    };
    expect(canCallStartNewConversation(agreed)).toBe(true);
  });

  it("allows start_new_conversation on an inbound_reopen thread in one call", () => {
    const flow = defaultFlow();
    const reopened: TurnContext = {
      tenantId: "t1",
      tenant: { name: "X", phone: "", intro: "", chatLanguage: "he" },
      agent: {
        id: "a1",
        tenantId: "t1",
        systemPrompt: "",
        knowledgeText: "",
        flow,
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
        lifecycleReason: "inbound_reopen",
      },
      lead: { id: "l1", externalUserId: "+1", fields: {} },
      messages: [
        { role: "agent", text: "האירוח אושר ל-2026-09-25 עד 2026-09-26." },
        { role: "lead", text: "תודה רבה" },
      ],
    };
    expect(canCallStartNewConversation(reopened)).toBe(true);
  });
});
