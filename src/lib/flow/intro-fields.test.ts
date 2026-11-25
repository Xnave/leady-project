import { describe, expect, it } from "vitest";
import type { TurnContext } from "./types";
import { fillIntro, introVars } from "./intro-fields";

function ctx(fields: Record<string, string>, introFields?: Record<string, string>): TurnContext {
  return {
    lead: { id: "l", externalUserId: "u", fields },
    capabilityState: introFields ? { documents: { introFields } } : {},
  } as unknown as TurnContext;
}

describe("introVars", () => {
  it("fills {{name}} from the lead field, and {{full_name}} is that same name", () => {
    const vars = introVars(ctx({ name: "נווה עיני" }));
    expect(fillIntro("היי {{name}}, כאן נווה", vars)).toBe("היי נווה עיני, כאן נווה");
    expect(fillIntro("היי {{full_name}}", vars)).toBe("היי נווה עיני");
  });

  it("uses the matched client name when the lead has none", () => {
    const vars = introVars(ctx({}, { full_name: "דנה כהן" }));
    expect(vars.name).toBe("דנה כהן");
    expect(fillIntro("היי {{name}}", vars)).toBe("היי דנה כהן");
  });

  it("lets the matched client name win over the lead name", () => {
    const vars = introVars(ctx({ name: "נווה עיני" }, { name: "דנה כהן" }));
    expect(vars.name).toBe("דנה כהן");
  });

  it("drops first and last name tokens, which are not lead fields", () => {
    const vars = introVars(ctx({ name: "נווה עיני" }));
    expect(fillIntro("היי {{full_name}}, {{first_name}} {{last_name}} כאן", vars)).toBe("היי נווה עיני, כאן");
  });
});
