import { describe, expect, it } from "vitest";
import { copyFor } from "@/lib/copy";
import {
  fallbackIntents,
  proposalNeedsConfirm,
  readCustomerTurn,
  type FactSnapshot,
} from "./customer-turn";
import { applyFactIntents, borrowersOf } from "./facts";
import { checklistSlots, MORTGAGE_RULES } from "./mortgage-rules";
import { mapSmartProfile } from "./smart-npv";

function client(extra: Record<string, unknown> = {}) {
  return mapSmartProfile({
    id_1: "123456782",
    firstname_1: "Dana",
    lastname_1: "Levi",
    phone_1: "0500000000",
    status_report_1: "1",
    banks_accounts: [{ uuid: "acct-1" }],
    liabilities: [{ balance: "1" }],
    ...extra,
  });
}

function ready(extra: Record<string, unknown> = {}) {
  return { ...client(extra), firstHome: "true" as const, secondBorrower: "no" as const };
}

function snapshot(over: Partial<FactSnapshot> = {}): FactSnapshot {
  return {
    loans: "known",
    employment: "salaried",
    employmentSource: "status_report",
    secondBorrower: "no",
    firstHome: "true",
    coupleSplit: "unknown",
    splitWho: "",
    salaryDeposit: "",
    loanMore: "",
    openQuestion: "",
    documentOpen: true,
    ...over,
  };
}

describe("customer turn", () => {
  it("does not treat a question, filler, or unclear line as a change", () => {
    const current = snapshot();
    for (const text of ["בעצם", "זה לא נטען", "זה לא ברור", "תוכל/י לשלוח רישיון במקום?", "אם יש לי הלוואות זה משנה?"]) {
      expect(fallbackIntents(text, current)).toEqual([]);
    }
    const none = snapshot({ loans: "none" });
    expect(fallbackIntents("אם יש לי הלוואות זה משנה?", none)).toEqual([]);
  });

  it("proposes both intents in one sentence and applies neither until asked", () => {
    const profile = ready();
    const current = snapshot();
    const intents = fallbackIntents("שלחתי בטעות רישיון, ובעצם אני עצמאי", current);
    expect(intents.map((intent) => intent.kind).sort()).toEqual(["fact", "retract"]);
    expect(intents).toContainEqual(expect.objectContaining({ kind: "retract", target: "id_card_back" }));
    expect(intents).toContainEqual(expect.objectContaining({ kind: "fact", fact: "employment", value: "self_employed" }));
    expect(proposalNeedsConfirm(current, intents)).toBe(true);
    expect(borrowersOf(profile).find((borrower) => borrower.slot === "1")?.employment).toBe("salaried");
    expect(borrowersOf(profile).find((borrower) => borrower.slot === "1")?.employmentSource).toBe("status_report");
    const applied = applyFactIntents(profile, intents);
    const person = borrowersOf(applied.profile).find((borrower) => borrower.slot === "1");
    expect(person?.employment).toBe("self_employed");
    expect(person?.employmentSource).toBe("customer");
    expect(applied.profile.employmentConflict).toEqual(expect.stringContaining("שכיר"));
    expect(applied.profile.advisorFlag).toBe("");
    const types = checklistSlots(applied.profile, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types).toContain("tax_assessment");
    expect(types).toContain("accountant_letter");
    expect(types).not.toContain("payslip");
    expect(copyFor("he").chat.documents.confirmTurn(["להוריד את הצד השני", "לרשום שהתעסוקה היא עצמאי/ת"])).toContain("רק לוודא");
  });

  it("keeps a status-report employment until the correction is applied", () => {
    const profile = ready({ status_report_1: "0" });
    const current = snapshot({ employment: "self_employed", loans: "known" });
    const intents = fallbackIntents("בעצם אני שכיר", current);
    expect(proposalNeedsConfirm(current, intents)).toBe(true);
    expect(borrowersOf(profile)[0]?.employmentSource).toBe("status_report");
    const applied = applyFactIntents(profile, intents);
    expect(borrowersOf(applied.profile)[0]?.employment).toBe("salaried");
    expect(borrowersOf(applied.profile)[0]?.employmentSource).toBe("customer");
    expect(String(applied.profile.employmentConflict)).toContain("עצמאי");
    const types = checklistSlots(applied.profile, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types.filter((type) => type === "payslip")).toHaveLength(3);
    expect(types).not.toContain("tax_assessment");
  });

  it("reads שכיר וגם עצמאי as both and a stored loan correction as a fact", () => {
    expect(fallbackIntents("אני שכיר וגם עצמאי", snapshot({ employment: "unknown", employmentSource: "" }))).toContainEqual(
      expect.objectContaining({ fact: "employment", value: "both" }),
    );
    const none = { ...ready(), loans: "none" as const, hasLoans: false, loanMore: "no" };
    const intents = fallbackIntents("בעצם יש לי הלוואותצ", snapshot({ loans: "none" }));
    expect(proposalNeedsConfirm(snapshot({ loans: "none" }), intents)).toBe(true);
    expect(applyFactIntents(none, intents).profile.loans).toBe("known");
    expect(checklistSlots(applyFactIntents(none, intents).profile, MORTGAGE_RULES).map((slot) => slot.docType)).toContain("loan_balances");
  });

  it("holds a low-confidence how-to and keeps a confident one", () => {
    const current = snapshot();
    expect(proposalNeedsConfirm(current, [{ kind: "how_to", detail: "steps", confidence: 0.4 }])).toBe(true);
    expect(proposalNeedsConfirm(current, fallbackIntents("מאיפה אני משיג?", current))).toBe(false);
    expect(fallbackIntents("לא הבנתי לאן אני נכנס?", current)).toEqual([
      expect.objectContaining({ kind: "how_to", detail: "steps" }),
    ]);
    expect(fallbackIntents("אין לי", current)).toEqual([
      expect.objectContaining({ kind: "how_to", detail: "short" }),
    ]);
  });

  it("keeps an empty model read and falls back when the call throws", async () => {
    const current = snapshot({ loans: "none" });
    const empty = await readCustomerTurn(
      { message: "בעצם יש לי הלוואות", snapshot: current, lastAgentMessage: "" },
      { complete: async () => ({ intents: [] }) },
    );
    expect(empty).toEqual({ intents: [], source: "model" });
    const failed = await readCustomerTurn(
      { message: "בעצם יש לי הלוואות", snapshot: current, lastAgentMessage: "" },
      { complete: async () => { throw new Error("model 503"); } },
    );
    expect(failed.source).toBe("fallback");
    expect(failed.intents).toContainEqual(expect.objectContaining({ fact: "loans", value: "known" }));
  });
});
