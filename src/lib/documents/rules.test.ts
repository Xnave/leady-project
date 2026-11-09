import { describe, expect, it } from "vitest";
import { copyFor } from "@/lib/copy";
import { documentAskText, reopenUploadedSlot } from "./dossier";
import { applyCustomerAnswers, applyExtractedBiometric, asksHowToGet, borrowersOf, declinesExistingLoans, employmentFromStatusReport, factsFromClient, missingTheDocument, nextQuestion, openQuestions, retractsLastFile } from "./facts";
import { checklistSlots, collectionYears, MORTGAGE_RULES, nextCollectionStageId } from "./mortgage-rules";
import { mapSmartProfile } from "./smart-npv";
import { parseRules, RulesError } from "./rules";
import { commitSlot, dossierDone, freshDossier, judgeFile, runChecks } from "./validate";

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
  return { ...client(extra), firstHome: "true", secondBorrower: "no" };
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
      expect(slots.map((slot) => slot.docType)).not.toContain("controlling_shareholder_letter");
      expect(openQuestions(profile).map((question) => question.kind)).not.toContain("employment");
      expect(openQuestions(profile).map((question) => question.kind)).not.toContain("salary_deposit");
      expect(slots.map((slot) => slot.id).filter((id) => id.startsWith("payslip#1#"))).toHaveLength(3);
      const statement = slots.find((slot) => slot.docType === "bank_statement");
      expect(statement?.months).toHaveLength(3);
      expect(statement?.collectionStage).toBe("1");
    }
  });

  it("asks for employment and skips payslips when the code is empty", () => {
    const profile = ready({ status_report_1: "" });
    expect(nextQuestion(profile)?.kind).toBe("employment");
    expect(documentAskText(nextQuestion(profile)!, "he", copyFor("he").chat)).toContain("בעל שליטה");
    expect(checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType)).not.toContain("payslip");
    const answered = applyCustomerAnswers(profile, "אני שכירה").profile;
    expect(checklistSlots(answered, MORTGAGE_RULES).filter((slot) => slot.docType === "payslip")).toHaveLength(3);
  });

  it("asks whether there is a second borrower when the file has one person", () => {
    const profile = client();
    expect(nextQuestion(profile)?.kind).toBe("second_borrower");
    expect(checklistSlots(profile, MORTGAGE_RULES)).toEqual([]);
    const alone = applyCustomerAnswers(profile, "לא").profile;
    expect(alone.secondBorrower).toBe("no");
    expect(alone.borrowers).toHaveLength(1);
    const pair = applyCustomerAnswers(profile, "כן").profile;
    expect(pair.borrowers?.map((borrower) => borrower.slot)).toEqual(["1", "2"]);
    expect(nextQuestion(pair)?.kind).toBe("couple_split");
  });

  it("asks the personal questions before any slot when the file has nobody", () => {
    const profile = factsFromClient({});
    expect(nextQuestion(profile)?.kind).toBe("second_borrower");
    expect(checklistSlots(profile, MORTGAGE_RULES)).toEqual([]);
  });

  it("opens both lists when the wife is salaried and the husband is self-employed", () => {
    const counted = applyCustomerAnswers(factsFromClient({}), "כן").profile;
    const split = applyCustomerAnswers(counted, "כן").profile;
    expect(split.borrowers?.map((borrower) => borrower.employment)).toEqual(["salaried", "self_employed"]);
    const profile = { ...split, firstHome: "true", loans: "none" };
    const types = checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types.filter((type) => type === "payslip")).toHaveLength(3);
    expect(types).toContain("tax_assessment");
    expect(types).toContain("accountant_letter");
    expect(types).not.toContain("controlling_shareholder_letter");
  });

  it("keeps the stage open after one statement when other documents are still missing", () => {
    const slots = checklistSlots(ready(), MORTGAGE_RULES);
    const state = freshDossier({ smartClientId: "c", profile: ready(), slots });
    const statement = state.slots.find((slot) => slot.docType === "bank_statement");
    expect(statement).toBeTruthy();
    if (!statement) return;
    const next = commitSlot(state, statement.id, "remote", "statement.pdf");
    expect(dossierDone(next.slots)).toBe(false);
    expect(next.status).toBe("gathering");
  });

  it("opens the other side only when the card is read as biometric", () => {
    const readyProfile = ready();
    expect(MORTGAGE_RULES.documents.id_appendix.checks).toEqual([]);
    expect(checklistSlots(readyProfile, MORTGAGE_RULES).map((slot) => slot.docType)).not.toContain("id_card_back");
    const yes = applyExtractedBiometric(readyProfile, "1", "yes");
    expect(checklistSlots(yes, MORTGAGE_RULES).some((slot) => slot.docType === "id_card_back" && slot.borrower === "1")).toBe(true);
    const waiting = { ...yes, imageBatchSlot: "id_card#1#0", idBackPending: "1" };
    expect(nextQuestion(waiting)?.kind).toBe("id_back");
    const no = applyExtractedBiometric(readyProfile, "1", "no");
    expect(checklistSlots(no, MORTGAGE_RULES).map((slot) => slot.docType)).not.toContain("id_card_back");
  });

  it("drops a document when its requirement row is removed", () => {
    const rules = {
      ...MORTGAGE_RULES,
      requirements: MORTGAGE_RULES.requirements.filter((row) => row.docType !== "payslip"),
    };
    expect(checklistSlots(ready(), rules).map((slot) => slot.docType)).not.toContain("payslip");
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
    expect(slots.filter((slot) => slot.docType === "accountant_letter")).toEqual([
      expect.objectContaining({ borrower: "2", year: years.accountantYear }),
    ]);
    expect(slots.filter((slot) => slot.altGroup)).toEqual([]);
    expect(slots.filter((slot) => slot.docType === "payslip").every((slot) => slot.borrower === "1")).toBe(true);
    expect(slots.map((slot) => slot.id)).toContain(`tax_assessment#2#${years.taxYear}`);
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
    expect(priorLetter.kind).toBe("unplaced");
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

  it("opens payslips and the shareholder form for code 3 without a deposit question", () => {
    const profile = ready({ status_report_1: "3" });
    expect(employmentFromStatusReport("3").employment).toBe("controlling_shareholder");
    expect(openQuestions(profile).map((question) => question.kind)).not.toContain("salary_deposit");
    const types = checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types.filter((type) => type === "payslip")).toHaveLength(3);
    expect(types).toContain("controlling_shareholder_letter");
    const answered = applyCustomerAnswers(ready({ status_report_1: "" }), "אני שכיר בעל שליטה").profile;
    expect(checklistSlots(answered, MORTGAGE_RULES).map((slot) => slot.docType)).toContain(
      "controlling_shareholder_letter",
    );
  });

  it("opens another loan balance when the customer says one more is needed", () => {
    const profile = { ...client(), firstHome: "true", secondBorrower: "no", loanMore: "pending" };
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

  it("opens one statement when the file lists no accounts", () => {
    const profile = { ...client({ banks_accounts: [] }), firstHome: "true", secondBorrower: "no" };
    const statements = checklistSlots(profile, MORTGAGE_RULES).filter((slot) => slot.docType === "bank_statement");
    expect(statements).toHaveLength(1);
    expect(openQuestions(profile).map((question) => question.kind)).not.toContain("accounts");
  });

  it("keeps the loan document when they only say they do not have the file", () => {
    const profile = { ...ready(), loans: "known" as const, hasLoans: true };
    expect(missingTheDocument("אין לי")).toBe(true);
    expect(missingTheDocument("התכוונתי שאין לי יתרת הלוואות")).toBe(true);
    expect(missingTheDocument("אה יש הלוואות אין לי את המסמך")).toBe(true);
    expect(declinesExistingLoans("אין לי")).toBe(false);
    expect(declinesExistingLoans("אין לי הלוואות")).toBe(true);
    const still = applyCustomerAnswers(profile, "אין לי").profile;
    expect(still.loans).toBe("known");
    expect(checklistSlots(still, MORTGAGE_RULES).map((slot) => slot.docType)).toContain("loan_balances");
    expect(applyCustomerAnswers(profile, "אין לי הלוואות").profile.loans).toBe("known");
    expect(copyFor("he").chat.documents.howTo("loan_balances")).toContain("בנק");
  });

  it("does not open a loan slot while liabilities are empty", () => {
    const base = client({ liabilities: [], current_mortgage: "" });
    expect(base.loans).toBe("unknown");
    const profile = { ...base, firstHome: "true", secondBorrower: "no" };
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

  it("treats a bare no as the next question only", () => {
    const profile = { ...client(), secondBorrower: "no" };
    expect(openQuestions(profile).map((question) => question.kind)).toEqual(["first_home"]);
    const answered = applyCustomerAnswers(profile, "לא").profile;
    expect(answered.firstHome).toBe("false");
    const employment = { ...client({ status_report_1: "" }), secondBorrower: "no" };
    expect(nextQuestion(employment)?.kind).toBe("employment");
    expect(applyCustomerAnswers(employment, "לא").changed).toBe(false);
  });

  it("a bare yes answers only the question that would be asked next", () => {
    const profile = client({ banks_accounts: [], liabilities: [] });
    expect(openQuestions(profile).map((question) => question.kind)).toEqual(["second_borrower", "first_home", "loans"]);
    expect(nextQuestion(profile)?.kind).toBe("second_borrower");
    const answered = applyCustomerAnswers(profile, "כן").profile;
    expect(answered.firstHome).toBe("unknown");
    expect(answered.secondBorrower).toBe("yes");
    expect(openQuestions(answered).map((question) => question.kind)[0]).toBe("couple_split");
    const declined = applyCustomerAnswers(answered, "לא").profile;
    expect(declined.coupleSplit).toBe("no");
    expect(nextQuestion(declined)?.kind).toBe("employment");
    const employed = applyCustomerAnswers(declined, "הוא עצמאי").profile;
    const home = applyCustomerAnswers(employed, "כן").profile;
    expect(home.firstHome).toBe("true");
    expect(applyCustomerAnswers(home, "לא").profile.loans).toBe("none");
  });

  it("flags other employment and opens identity only", () => {
    const profile = applyCustomerAnswers(ready({ status_report_1: "" }), "אחר").profile;
    expect(profile.advisorFlag).toEqual(expect.stringContaining("אחר"));
    const types = checklistSlots({ ...profile, firstHome: "true" }, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types).toContain("id_card");
    expect(types).not.toContain("payslip");
    expect(types).not.toContain("accountant_letter");
    expect(types).not.toContain("bank_statement");
  });

  it("drops income slots when the purchase is not a first home", () => {
    const profile = applyCustomerAnswers({ ...client(), secondBorrower: "no" }, "זו לא דירה ראשונה").profile;
    expect(profile.firstHome).toBe("false");
    const types = checklistSlots(profile, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(types).toContain("id_card");
    expect(types).not.toContain("payslip");
    expect(types).not.toContain("bank_statement");
  });

  it("rejects a blank form path that leaves the forms folder", () => {
    const raw = structuredClone(MORTGAGE_RULES) as unknown as {
      documents: { accountant_letter: { blankForm: { file: string; once: string } } };
    };
    raw.documents.accountant_letter.blankForm = { file: "../.env", once: "conversation" };
    expect(() => parseRules(raw)).toThrow(RulesError);
    raw.documents.accountant_letter.blankForm = { file: "nested/form.pdf", once: "conversation" };
    expect(() => parseRules(raw)).toThrow(RulesError);
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
    expect(parsed.documents.controlling_shareholder_letter.blankForm).toEqual({
      file: "אישור רואה חשבון לבעל שליטה (1).pdf",
      once: "conversation",
    });
  });

  it("does not overwrite a stored answer from the message text alone", () => {
    const none = { ...ready(), loans: "none" as const, hasLoans: false, loanMore: "no" };
    expect(applyCustomerAnswers(none, "בעצם יש לי הלוואות").profile.loans).toBe("none");
    expect(applyCustomerAnswers(none, "אם יש לי הלוואות זה משנה?").profile.loans).toBe("none");
    const selfEmployed = ready({ status_report_1: "0" });
    expect(borrowersOf(applyCustomerAnswers(selfEmployed, "בעצם אני שכיר").profile).find((borrower) => borrower.slot === "1")?.employment).toBe("self_employed");
    expect(borrowersOf(applyCustomerAnswers(selfEmployed, "בעצם אני שכיר").profile).find((borrower) => borrower.slot === "1")?.employmentSource).toBe("status_report");
    const both = applyCustomerAnswers(ready({ status_report_1: "" }), "אני שכיר וגם עצמאי").profile;
    expect(borrowersOf(both).find((borrower) => borrower.slot === "1")?.employment).toBe("both");
    expect(both.advisorFlag).toEqual(expect.stringContaining("שכיר ועצמאי"));
    const closed = checklistSlots(both, MORTGAGE_RULES).map((slot) => slot.docType);
    expect(closed).toContain("id_card");
    expect(closed).not.toContain("payslip");
    expect(closed).not.toContain("tax_assessment");
    expect(closed).not.toContain("bank_statement");
  });

  it("treats where-to-get as help and a named wrong file as a retraction", () => {
    expect(asksHowToGet("מאיפה אני משיג?")).toBe(true);
    expect(asksHowToGet("לא הבנתי לאן אני נכנס?")).toBe(true);
    expect(asksHowToGet("אין לי")).toBe(false);
    expect(copyFor("he").chat.documents.howToDetail("tax_assessment")).toContain("רשות המסים");
    expect(copyFor("en").chat.documents.howToDetail("tax_assessment")).toContain("personal area");
    expect(retractsLastFile("שלחתי צד שני של הרישיון")).toBe(true);
    expect(retractsLastFile("בעצם שלחתי לך צד שני של הרישיון")).toBe(true);
    expect(retractsLastFile("אין לי")).toBe(false);
    expect(retractsLastFile("מאיפה אני משיג?")).toBe(false);
    expect(retractsLastFile("זה לא נטען")).toBe(false);
    expect(retractsLastFile("זה לא ברור")).toBe(false);
    expect(retractsLastFile("אפשר לשלוח רישיון במקום?")).toBe(false);

    const profile = applyExtractedBiometric(ready(), "1", "yes");
    let state = freshDossier({ smartClientId: "c", profile, slots: checklistSlots(profile, MORTGAGE_RULES) });
    const back = state.slots.find((slot) => slot.docType === "id_card_back");
    expect(back).toBeTruthy();
    if (!back) return;
    state = commitSlot(state, back.id, "remote-licence", "licence.jpg");
    const undone = reopenUploadedSlot(state, "שלחתי צד שני של הרישיון");
    expect(undone?.slot.status).toBe("missing");
    expect(undone?.slot.remoteId).toBe("");
    expect(undone?.state.profile.idBackPending).toBe("1");
    expect(reopenUploadedSlot(state, "אין לי")).toBeNull();
  });
});
