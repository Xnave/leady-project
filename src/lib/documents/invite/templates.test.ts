import { describe, expect, it } from "vitest";
import { INVITE_TEMPLATES, fillInviteBody, inviteTemplateCreateBody, inviteTemplateParams } from "./templates";

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
  it("submits one quick-reply button and no footer", () => {
    const body = inviteTemplateCreateBody(INVITE_TEMPLATES.reminder, "acc-1");
    expect(body.accountId).toBe("acc-1");
    const buttons = body.components.find((c) => c.type === "BUTTONS");
    expect(buttons).toEqual({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "בואו נתחיל" }] });
    expect(body.components.some((c) => c.type === "FOOTER")).toBe(false);
  });
});
