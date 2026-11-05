import { describe, expect, it } from "vitest";
import { applyCustomerAnswers, employmentFromStatusReport, openQuestions } from "./facts";
import { checklistSlots, collectionYears, MORTGAGE_RULES, nextCollectionStageId } from "./mortgage-rules";
import { mapSmartProfile } from "./smart-npv";
import { parseRules, RulesError } from "./rules";
import { freshDossier, isOutstanding, judgeFile } from "./validate";

const ACCOUNT = { uuid: "acct-1" };

function client(extra: Record<string, unknown> = {}) {
  return mapSmartProfile({
    id_1: "123456782",
    firstname_1: "Dana",
    lastname_1: "Levi",
    phone_1: "0500000000",
    status_report_1: "1",
    banks_accounts: [ACCOUNT],
    liabilities: [{ balance: "1" }],
    ...extra,
  });
}

function ready(extra: Record<string, unknown> = {}) {
  return { ...client(extra), firstHome: "true" };
}

describe("mortgage checklist", () => {
  it("builds the salaried list from code 1 or 2", () => {
    for (const code of ["1", "2"]) {
      const profile = ready({ status_report_1: code });
      const slots = checklistSlots(profile, MORTGAGE_RULES);
      expect(slots.filter((slot) => slot.docType === "payslip")).toHaveLength(3);
      expect(slots.filter((slot) => slot.docType === "bank_statement")).toHaveLength(1);
      expect(slots.map((slot) => slot.docType)).toEqual(
        expect.arrayContaining(["id_card", "id_appendix", "payslip", "bank_statement", "loan_balances"]),
      );
      expect(slots.map((slot) => slot.docType)).not.toContain("tax_assessment");
      expect(openQuestions(profile).map((question) => question.kind)).not.toContain("employment");
      expect(slots.map((slot) => slot.id).filter((id) => id.startsWith("payslip#1#"))).toHaveLength(3);
      const statement = slots.find((slot) => slot.docType === "bank_statement");
      expect(statement?.months).toHaveLength(3);
      expect(statement?.collectionStage).toBe("1");
    }
  });

  it("asks for employment and skips payslips when the code is empty", () => {
    const profile = ready({ status_report_1: "" });
    expect(checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType)).not.toContain("payslip");
    const answered = applyCustomerAnswers(profile, "אני שכירה").profile;
    expect(checklistSlots(answered, MORTGAGE_RULES).filter((slot) => slot.docType === "payslip")).toHaveLength(3);
  });

  it("gives the self-employed list only to the borrower whose code is 0", () => {
    const profile = {
      ...client({
      status_report_1: "1",
      id_2: "209876543",
      firstname_2: "Noam",
      lastname_2: "Levi",
      phone_2: "0521111111",
      status_report_2: "0",
    }),
      firstHome: "true",
    };
    const slots = checklistSlots(profile, MORTGAGE_RULES);
    const years = collectionYears();
    expect(slots.filter((slot) => slot.docType === "tax_assessment").map((slot) => slot.borrower)).toEqual(["2"]);
    expect(slots.filter((slot) => slot.docType === "accountant_letter").map((slot) => slot.borrower)).toEqual(["2", "2"]);
    const current = slots.find((slot) => slot.docType === "accountant_letter" && slot.year === years.accountantYear);
    const prior = slots.filter((slot) => slot.altGroup === "prior-income#2");
    expect(current?.altGroup).toBeUndefined();
    expect(prior.map((slot) => slot.docType).sort()).toEqual(["accountant_letter", "tax_assessment"]);
    expect(slots.filter((slot) => slot.docType === "payslip").every((slot) => slot.borrower === "1")).toBe(true);
    expect(slots.map((slot) => slot.id)).toContain(`tax_assessment#2#${years.taxYear}`);
    const state = freshDossier({ smartClientId: "c", profile, slots });
    const tax = state.slots.find((slot) => slot.docType === "tax_assessment");
    expect(tax).toBeTruthy();
    if (!tax) return;
    tax.status = "uploaded";
    const other = state.slots.find((slot) => slot.altGroup === tax.altGroup && slot.id !== tax.id);
    expect(other && isOutstanding(other, state.slots)).toBe(false);
    expect(current && isOutstanding({ ...current, status: "missing", failCount: 0, lastReason: "", remoteId: "", filename: "" }, state.slots)).toBe(true);
    const dossier = freshDossier({ smartClientId: "c", profile, slots });
    const routed = judgeFile(dossier, MORTGAGE_RULES, {
      docType: "tax_assessment",
      fields: { fullName: "Noam Levi", year: String(years.taxYear) },
    });
    expect(routed.kind).toBe("accept");
    if (routed.kind === "accept") expect(routed.slotId).toBe(`tax_assessment#2#${years.taxYear}`);
    const priorLetter = judgeFile(dossier, MORTGAGE_RULES, {
      docType: "accountant_letter",
      fields: { fullName: "Noam Levi", year: String(years.taxYear) },
    });
    expect(priorLetter.kind).toBe("accept");
    if (priorLetter.kind === "accept") expect(priorLetter.slotId).toBe(`accountant_letter#2-prior#${years.taxYear}`);
    const currentLetter = judgeFile(dossier, MORTGAGE_RULES, {
      docType: "accountant_letter",
      fields: { fullName: "Noam Levi", year: String(years.accountantYear) },
    });
    expect(currentLetter.kind).toBe("accept");
    if (currentLetter.kind === "accept") expect(currentLetter.slotId).toBe(`accountant_letter#2#${years.accountantYear}`);
    expect(
      judgeFile(dossier, MORTGAGE_RULES, { docType: "accountant_letter", fields: { fullName: "Noam Levi" } }).kind,
    ).toBe("unplaced");
  });

  it("asks a controlling shareholder about the salary deposit before opening payslips", () => {
    const profile = { ...client({ status_report_1: "3" }), firstHome: "true" };
    expect(checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType)).not.toContain("payslip");
    expect(openQuestions(profile).map((question) => question.kind)).toContain("salary_deposit");
    const yes = applyCustomerAnswers(profile, "המשכורת מופקדת לחשבון").profile;
    expect(checklistSlots(yes, MORTGAGE_RULES).filter((slot) => slot.docType === "payslip")).toHaveLength(3);
    expect(checklistSlots(yes, MORTGAGE_RULES).map((slot) => slot.docType)).not.toContain("controlling_shareholder_letter");
    const no = applyCustomerAnswers(profile, "המשכורת לא מופקדת").profile;
    const types = checklistSlots(no, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types.filter((type) => type === "payslip")).toHaveLength(3);
    expect(types).toContain("controlling_shareholder_letter");
  });

  it("opens another loan balance when the customer says one more is needed", () => {
    const profile = { ...client(), firstHome: "true", loanMore: "pending" };
    const another = applyCustomerAnswers(profile, "יש הלוואות נוספות").profile;
    expect(another.loanCount).toBe(2);
    expect(checklistSlots(another, MORTGAGE_RULES).filter((slot) => slot.docType === "loan_balances")).toHaveLength(2);
    const stop = applyCustomerAnswers(profile, "אין הלוואות נוספות").profile;
    expect(stop.loanMore).toBe("no");
    expect(checklistSlots(stop, MORTGAGE_RULES).filter((slot) => slot.docType === "loan_balances")).toHaveLength(1);
  });

  it("flags both-employment and does not open payslips or the accountant letter", () => {
    const profile = client({ status_report_1: "5" });
    const slots = checklistSlots(profile, MORTGAGE_RULES);
    expect(profile.advisorFlag).toEqual(expect.stringContaining("שכיר ועצמאי"));
    expect(slots.map((slot) => slot.docType)).not.toContain("payslip");
    expect(slots.map((slot) => slot.docType)).not.toContain("accountant_letter");
    expect(slots.map((slot) => slot.docType)).not.toContain("bank_statement");
  });

  it("does not open a loan slot while liabilities are empty", () => {
    const base = client({ liabilities: [], current_mortgage: "" });
    expect(base.loans).toBe("unknown");
    const profile = { ...base, firstHome: "true" };
    expect(checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType)).not.toContain("loan_balances");
    const answered = applyCustomerAnswers(profile, "יש הלוואות").profile;
    expect(checklistSlots(answered, MORTGAGE_RULES).map((slot) => slot.docType)).toContain("loan_balances");
  });

  it("does not treat an empty status report as self-employed", () => {
    expect(employmentFromStatusReport("")).toEqual({ employment: "unknown", label: "" });
    expect(employmentFromStatusReport("0").employment).toBe("self_employed");
  });

  it("leaves an ID slot missing when a Smart NPV file is only a title", () => {
    const slots = checklistSlots(ready(), MORTGAGE_RULES);
    expect(slots.find((slot) => slot.docType === "id_card")).toMatchObject({ borrower: "1" });
    expect(slots.every((slot) => !("remoteId" in slot))).toBe(true);
  });

  it("opens no document slots while a fact question is still open", () => {
    expect(checklistSlots(client(), MORTGAGE_RULES)).toEqual([]);
  });

  it("opens only the released collection stage", () => {
    const rules = parseRules({
      ...MORTGAGE_RULES,
      collectionStages: [
        { id: "1", labels: { he: "א", en: "A" } },
        { id: "2", labels: { he: "ב", en: "B" } },
      ],
      requirements: [
        ...MORTGAGE_RULES.requirements,
        { docType: "id_card", stage: "identity", collectionStage: "2" },
      ],
    });
    const slots = checklistSlots({ ...ready(), releasedStageId: "2" }, rules);
    expect(slots.map((slot) => slot.collectionStage)).toEqual(["2"]);
    expect(nextCollectionStageId(rules, "1")).toBe("2");
    expect(nextCollectionStageId(rules, "2")).toBe("");
  });

  it("treats a bare no as not a first home only when that is the open question", () => {
    const profile = client();
    expect(openQuestions(profile).map((question) => question.kind)).toEqual(["first_home"]);
    const answered = applyCustomerAnswers(profile, "לא").profile;
    expect(answered.firstHome).toBe("false");
    expect(applyCustomerAnswers(client({ status_report_1: "" }), "לא").changed).toBe(false);
  });

  it("drops income slots when the purchase is not a first home", () => {
    const profile = applyCustomerAnswers(client(), "זו לא דירה ראשונה").profile;
    expect(profile.firstHome).toBe("false");
    const types = checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types).toContain("id_card");
    expect(types).not.toContain("payslip");
    expect(types).not.toContain("bank_statement");
  });

  it("rejects an unknown check op", () => {
    const raw = structuredClone(MORTGAGE_RULES) as unknown as {
      documents: { id_card: { checks: { op: string }[] } };
    };
    raw.documents.id_card.checks = [{ op: "looks_official" }];
    expect(() => parseRules(raw)).toThrow(RulesError);
  });

  it("keeps the collection years on the rules document", () => {
    const years = collectionYears(new Date("2026-11-05T12:00:00+02:00"));
    expect(years).toEqual({ taxYear: 2025, accountantYear: 2026 });
    const parsed = parseRules(MORTGAGE_RULES);
    expect(parsed.taxYear).toBe(collectionYears().taxYear);
    expect(parsed.accountantYear).toBe(collectionYears().accountantYear);
    expect(parsed.collectionStages?.[0]?.id).toBe("1");
    expect(nextCollectionStageId(parsed, "1")).toBe("");
    expect(parsed.documents.accountant_letter.blankForm).toEqual({
      file: "אישור רואה חשבון עוסק מורשה.pdf",
      once: "conversation",
    });
  });
});
