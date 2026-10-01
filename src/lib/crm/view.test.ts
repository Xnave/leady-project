import { describe, expect, it } from "vitest";
import { whereItStands } from "./view";

describe("whereItStands", () => {
  const none = { nextStepText: null, requestLine: null, summary: null, intentLabel: null, lastLeadText: null };
  it("prefers next step, then request, then summary, then intent + last message", () => {
    expect(whereItStands({ ...none, nextStepText: "Call", requestLine: "x" })).toBe("Call");
    expect(whereItStands({ ...none, requestLine: "Villa · 12–15/10", summary: "s" })).toBe("Villa · 12–15/10");
    expect(whereItStands({ ...none, summary: "Wants a quote" })).toBe("Wants a quote");
    expect(whereItStands({ ...none, intentLabel: "Pricing", lastLeadText: "how much?" })).toBe("Pricing · how much?");
    expect(whereItStands(none)).toBe("");
  });
  it("trims long messages to 60 chars with an ellipsis", () => {
    const out = whereItStands({ ...none, lastLeadText: "a".repeat(80) });
    expect(out.length).toBe(61);
    expect(out.endsWith("…")).toBe(true);
  });
});
