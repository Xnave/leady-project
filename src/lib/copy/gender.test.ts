import { describe, expect, it } from "vitest";
import { copyFor } from "./index";

const MASC_IMPERATIVE = /(^|[\s.,!?])(ספר|כתוב|שלח|בחר|תגיד|תבחר|תכתוב)(?=[\s.,!?]|$)/;

function strings(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === "string") out.push(obj);
  else if (typeof obj === "function") {
    const r = (obj as (...a: unknown[]) => unknown)("X", "Y", "Z");
    if (typeof r === "string") out.push(r);
  } else if (obj && typeof obj === "object") Object.values(obj).forEach((v) => strings(v, out));
  return out;
}

describe("hebrew chat copy", () => {
  it("never addresses the customer with masculine imperatives", () => {
    for (const s of strings(copyFor("he").chat)) expect(s).not.toMatch(MASC_IMPERATIVE);
  });

  it("self-reference follows persona gender", () => {
    expect(copyFor("he", { gender: "female" }).chat.savingVisit).toMatch(/קולטת/);
    expect(copyFor("he", { gender: "male" }).chat.savingVisit).toMatch(/קולט /);
    expect(copyFor("he", { gender: "neutral" }).chat.savingVisit).toMatch(/קולטים/);
    expect(copyFor("he").chat.savingVisit).toMatch(/קולטים/);
  });

  it("english unaffected by gender", () => {
    expect(copyFor("en", { gender: "female" }).chat).toEqual(copyFor("en").chat);
  });
});
