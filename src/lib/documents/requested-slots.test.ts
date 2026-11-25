import { describe, expect, it } from "vitest";
import { copyFor } from "@/lib/copy";
import { mergeSlots, requestedSlots } from "./dossier";
import { MORTGAGE_RULES } from "./mortgage-rules";
import { freshDossier, dossierDone, type DossierState } from "./validate";

function state(): DossierState {
  return freshDossier({
    smartClientId: "c",
    profile: { releasedStageId: "1" },
    slots: [{ id: "id_card#1#0", docType: "id_card", stage: "identity", index: 0, collectionStage: "1" }],
  });
}

describe("advisor-requested documents", () => {
  it("opens one slot per catalog type on the current wave and skips unknown types", () => {
    const added = requestedSlots(state(), MORTGAGE_RULES, ["payslip", "payslip", "not_a_type"]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      id: "payslip#req#0",
      docType: "payslip",
      stage: "income",
      collectionStage: "1",
      requested: true,
      status: "missing",
    });
  });

  it("never reuses an id already on the file", () => {
    const first = state();
    first.slots.push(...requestedSlots(first, MORTGAGE_RULES, ["payslip"]));
    expect(requestedSlots(first, MORTGAGE_RULES, ["payslip"])[0]?.id).toBe("payslip#req#1");
  });

  it("keeps a missing requested slot when the checklist is recomputed from the rules", () => {
    const current = state();
    current.slots.push(...requestedSlots(current, MORTGAGE_RULES, ["loan_balances"]));
    const merged = mergeSlots(current.slots, [{ id: "id_card#1#0", docType: "id_card", stage: "identity", index: 0 }]);
    expect(merged.map((slot) => slot.id)).toEqual(["id_card#1#0", "loan_balances#req#0"]);
    expect(dossierDone(merged)).toBe(false);
  });

  it("names every requested document in one message, with the advisor note", () => {
    expect(copyFor("he").chat.documents.requestFiles(["נסח טאבו"], "")).toContain("נסח טאבו");
    const many = copyFor("en").chat.documents.requestFiles(["Appraisal report", "Land registry extract"], "From the last month.");
    expect(many).toContain("• Appraisal report");
    expect(many).toContain("From the last month.");
  });
});
