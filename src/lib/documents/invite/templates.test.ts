import { describe, expect, it } from "vitest";
import { isStopReply } from "./plan";
import { INVITE_STOP_BUTTON, INVITE_TEMPLATES, fillInviteBody, inviteTemplateCreateBody, inviteTemplateParams } from "./templates";

describe("invite templates", () => {
  it("never start or end the body with a variable (Meta rule)", () => {
    for (const t of Object.values(INVITE_TEMPLATES)) {
      expect(t.body.trim().startsWith("{{")).toBe(false);
      expect(t.body.trim().endsWith("}}")).toBe(false);
      expect(t.name).toMatch(/^[a-z0-9_]+_v\d+$/);
      expect(t.category).toBe("UTILITY");
      expect(t.language).toBe("he");
    }
  });
  it("fills the opener with the client and advisor name", () => {
    const text = fillInviteBody(INVITE_TEMPLATES.opener, inviteTemplateParams("דנה", "ליאור - לייבל משכנתאות"));
    expect(text.startsWith("שלום דנה 👋")).toBe(true);
    expect(text).toContain("כאן העוזר הדיגיטלי של ליאור - לייבל משכנתאות.");
    expect(text).not.toContain("{{");
  });
  it("submits a start and a stop quick-reply button and no footer", () => {
    for (const t of Object.values(INVITE_TEMPLATES)) {
      const body = inviteTemplateCreateBody(t, "acc-1");
      expect(body.accountId).toBe("acc-1");
      const buttons = body.components.find((c) => c.type === "BUTTONS");
      expect(buttons).toEqual({
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "בואו נתחיל" },
          { type: "QUICK_REPLY", text: "הסר" },
        ],
      });
      expect(body.components.some((c) => c.type === "FOOTER")).toBe(false);
    }
  });
  it("treats a tap on the stop button as a stop reply", () => {
    expect(isStopReply(INVITE_STOP_BUTTON)).toBe(true);
    for (const t of Object.values(INVITE_TEMPLATES)) expect(isStopReply(t.buttons[0])).toBe(false);
  });
});
