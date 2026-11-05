import { describe, expect, it } from "vitest";
import {
  AD_PREFIX,
  LOCKED_BUTTONS,
  composeTemplate,
  footerLine,
  newTemplateName,
  normalizeTemplateStatus,
  parseTemplateStatusEvent,
  previewText,
  templateCreateBody,
  templateVariables,
  validateTemplate,
  type TemplateDraft,
} from "./templates";

const biz = { adPrefixEnabled: true, businessName: "ליאור משכנתאות", businessPhone: "050-1234567" };

function draft(over: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    title: "Refinance check",
    category: "MARKETING",
    language: "he",
    body: "היי {{1}}, עברו כמה שנים מאז המשכנתא. נשמח לבדוק אם מחזור יכול לחסוך לך.",
    examples: ["דנה"],
    ...over,
  };
}

describe("composeTemplate: locked additions", () => {
  it("prefixes marketing templates with פרסומת and adds the footer and the three buttons", () => {
    const c = composeTemplate(draft(), biz);
    expect(c.text.startsWith(`${AD_PREFIX} | היי {{1}}`)).toBe(true);
    expect(c.footer).toBe("ליאור משכנתאות · 050-1234567");
    expect(c.buttons).toEqual([...LOCKED_BUTTONS.he]);
    expect(c.buttons.at(-1)).toBe("הסרה");
  });

  it("uses the template language for the buttons", () => {
    expect(composeTemplate(draft({ language: "en" }), biz).buttons).toEqual(["Interested", "Not now", "Unsubscribe"]);
  });

  it("drops only the prefix when a platform admin turned it off", () => {
    const c = composeTemplate(draft(), { ...biz, adPrefixEnabled: false });
    expect(c.text.startsWith("היי")).toBe(true);
    expect(c.buttons).toHaveLength(3);
    expect(c.footer).not.toBe("");
  });

  it("leaves utility templates as written", () => {
    const c = composeTemplate(draft({ category: "UTILITY", body: "התור שלך מחר ב-{{1}} בבוקר." }), biz);
    expect(c).toEqual({ text: "התור שלך מחר ב-{{1}} בבוקר.", footer: "", buttons: [] });
  });

  it("every locked button fits Meta's 25 characters", () => {
    for (const buttons of Object.values(LOCKED_BUTTONS)) for (const b of buttons) expect(b.length).toBeLessThanOrEqual(25);
  });
});

describe("footerLine", () => {
  it("drops the phone first, then cuts the name to 60", () => {
    const longName = "א".repeat(55);
    expect(footerLine(longName, "050-1234567")).toBe(longName);
    expect(footerLine("ב".repeat(70), "")).toHaveLength(60);
    expect(footerLine("", "050")).toBe("050");
  });
});

describe("validateTemplate", () => {
  const check = (d: TemplateDraft, adPrefixEnabled = true) => validateTemplate(d, composeTemplate(d, { ...biz, adPrefixEnabled }));

  it("accepts a normal marketing template", () => {
    expect(check(draft())).toEqual([]);
  });

  it("needs a title and a body", () => {
    expect(check(draft({ title: " ", body: "" }))).toEqual(["title_required", "body_required"]);
  });

  it("needs {{1}}, {{2}} in order with an example for each", () => {
    expect(check(draft({ body: "שלום {{2}} ו-{{1}} מה שלומכם?", examples: ["a", "b"] }))).toContain("variables_not_sequential");
    expect(check(draft({ body: "שלום {{1}} ו-{{3}} מה שלומכם?", examples: ["a", "b"] }))).toContain("variables_not_sequential");
    expect(check(draft({ body: "שלום {{1}} ו-{{2}} מה שלומכם?", examples: ["a", " "] }))).toContain("example_missing");
  });

  it("rejects a body ending with a variable, and a start variable once the prefix is off", () => {
    expect(check(draft({ body: "המשכנתא שלך נחתמה ב {{1}}.", examples: ["2020"] }))).toContain("variable_at_end");
    expect(check(draft({ body: "{{1}}, עברו כמה שנים.", examples: ["דנה"] }))).toEqual([]);
    expect(check(draft({ body: "{{1}}, עברו כמה שנים.", examples: ["דנה"] }), false)).toContain("variable_at_start");
  });

  it("stops the owner from typing the label themselves", () => {
    expect(check(draft({ body: "פרסומת: היי {{1}} מה נשמע?" }))).toContain("prefix_in_body");
  });

  it("counts the prefix toward Meta's 1024 limit", () => {
    expect(check(draft({ body: "א".repeat(1020), examples: [] }))).toContain("body_too_long");
  });
});

describe("templateCreateBody", () => {
  it("builds Zernio's body with example values, footer and quick replies", () => {
    const d = draft();
    const body = templateCreateBody({ accountId: "acc1", name: "zc_x", draft: d, composed: composeTemplate(d, biz) });
    expect(body).toMatchObject({ accountId: "acc1", name: "zc_x", category: "MARKETING", language: "he" });
    expect(body.components[0]).toEqual({
      type: "BODY",
      text: `${AD_PREFIX} | ${d.body}`,
      example: { body_text: [["דנה"]] },
    });
    expect(body.components[1]).toEqual({ type: "FOOTER", text: "ליאור משכנתאות · 050-1234567" });
    expect(body.components[2]).toEqual({
      type: "BUTTONS",
      buttons: LOCKED_BUTTONS.he.map((text) => ({ type: "QUICK_REPLY", text })),
    });
  });

  it("omits the example and extra components when there is nothing to add", () => {
    const d = draft({ category: "UTILITY", body: "התור שלך אושר, נתראה." , examples: [] });
    const body = templateCreateBody({ accountId: "a", name: "n", draft: d, composed: composeTemplate(d, biz) });
    expect(body.components).toEqual([{ type: "BODY", text: "התור שלך אושר, נתראה." }]);
  });
});

describe("helpers", () => {
  it("lists variables in order of first appearance", () => {
    expect(templateVariables("{{1}} {{2}} {{1}} {{ 3 }}")).toEqual([1, 2, 3]);
  });

  it("fills examples into the preview and keeps unfilled ones", () => {
    expect(previewText("היי {{1}} ו{{2}}", ["דנה"])).toBe("היי דנה ו{{2}}");
  });

  it("makes Meta-safe unique names", () => {
    const name = newTemplateName(new Date(0), () => 0.5);
    expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(newTemplateName(new Date(1), () => 0.1)).not.toBe(name);
  });

  it("maps unknown statuses to PENDING", () => {
    expect(normalizeTemplateStatus("approved")).toBe("APPROVED");
    expect(normalizeTemplateStatus("weird")).toBe("PENDING");
  });
});

describe("parseTemplateStatusEvent", () => {
  it("reads Zernio's whatsapp.template.status_updated", () => {
    expect(
      parseTemplateStatusEvent({
        event: "whatsapp.template.status_updated",
        account: { id: "acc1" },
        template: { templateId: "123", name: "zc_x", language: "he", status: "REJECTED", reason: "INVALID_FORMAT" },
      }),
    ).toEqual({ accountId: "acc1", name: "zc_x", language: "he", status: "REJECTED", reason: "INVALID_FORMAT", providerId: "123" });
  });

  it("clears Meta's NONE reason and ignores other events", () => {
    const ok = parseTemplateStatusEvent({
      event: "whatsapp.template.status_updated",
      template: { name: "zc_x", language: "he", status: "APPROVED", reason: "NONE" },
    });
    expect(ok?.reason).toBe("");
    expect(parseTemplateStatusEvent({ event: "message.received" })).toBeNull();
    expect(parseTemplateStatusEvent({ event: "whatsapp.template.status_updated", template: {} })).toBeNull();
  });
});
