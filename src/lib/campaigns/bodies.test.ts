import { describe, expect, it } from "vitest";
import { actionBodySchema, confirmBodySchema } from "./manage";
import { DECLARATION_VERSION } from "./rules";

describe("campaign route bodies", () => {
  it("accepts a declaration and rejects a missing or wrong one", () => {
    const ok = { declarationAccepted: true, declarationVersion: DECLARATION_VERSION, language: "he" };
    expect(confirmBodySchema.safeParse(ok).success).toBe(true);
    expect(confirmBodySchema.safeParse({ ...ok, language: "en" }).success).toBe(true);
    expect(confirmBodySchema.safeParse({ ...ok, declarationAccepted: false }).success).toBe(false);
    expect(confirmBodySchema.safeParse({ ...ok, declarationVersion: "old" }).success).toBe(false);
    expect(confirmBodySchema.safeParse({ ...ok, language: "fr" }).success).toBe(false);
    expect(confirmBodySchema.safeParse({}).success).toBe(false);
  });

  it("accepts pause, resume and cancel only", () => {
    expect(actionBodySchema.safeParse({ action: "pause" }).success).toBe(true);
    expect(actionBodySchema.safeParse({ action: "resume" }).success).toBe(true);
    expect(actionBodySchema.safeParse({ action: "cancel" }).success).toBe(true);
    expect(actionBodySchema.safeParse({ action: "delete" }).success).toBe(false);
    expect(actionBodySchema.safeParse({}).success).toBe(false);
  });
});
