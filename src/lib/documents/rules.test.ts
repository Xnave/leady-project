import { describe, expect, it } from "vitest";
import { EMPLOYED_WITH_LOANS, MORTGAGE_RULES, SELF_EMPLOYED_NO_LOANS } from "./mortgage-rules";
import { parseRules, requiredSlots, RulesError } from "./rules";

describe("mortgage rules", () => {
  it("asks for one income confirmation and loan balances when employed with loans", () => {
    const slots = requiredSlots(EMPLOYED_WITH_LOANS, MORTGAGE_RULES);
    const types = slots.map((slot) => slot.docType);
    expect(types.filter((type) => type === "income_confirmation")).toHaveLength(1);
    expect(types.filter((type) => type === "bank_statement")).toHaveLength(3);
    expect(types).toContain("loan_balances");
    expect(types).toContain("id_card");
    expect(types).toContain("id_appendix");
    expect(slots[0]?.stage).toBe("identity");
    expect(slots.find((slot) => slot.docType === "loan_balances")?.stage).toBe("banking");
  });

  it("asks for two income confirmations and skips loans when self-employed", () => {
    const types = requiredSlots(SELF_EMPLOYED_NO_LOANS, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types.filter((type) => type === "income_confirmation")).toHaveLength(2);
    expect(types).not.toContain("loan_balances");
  });

  it("rejects an unknown check op", () => {
    const raw = structuredClone(MORTGAGE_RULES) as unknown as {
      documents: { id_card: { checks: { op: string }[] } };
    };
    raw.documents.id_card.checks = [{ op: "looks_official" }];
    expect(() => parseRules(raw)).toThrow(RulesError);
  });
});
