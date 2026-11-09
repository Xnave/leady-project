import {
  accountsOf,
  borrowersOf,
  ensureBorrowers,
  factsOpen,
  loanCountOf,
  type BorrowerFact,
} from "./facts";
import {
  conditionMatches,
  type Condition,
  type Profile,
  type Requirement,
  type RulesDocument,
  type Slot,
} from "./rules";
import { priorCalendarMonths } from "./validate";

/** Current calendar year is the accountant letter. The year before it is the tax assessment. */
export function collectionYears(now: Date = new Date()): { taxYear: number; accountantYear: number } {
  const accountantYear = now.getFullYear();
  return { accountantYear, taxYear: accountantYear - 1 };
}

/**
 * Israeli mortgage file. Identity is always open. Income and banking
 * come from each borrower's employment and known loans. A statement is
 * one file per listed account, or one file when the file lists none.
 * A person who is both salaried and self-employed, or a purchase that is
 * not a first home, does not get those lists.
 */
export const MORTGAGE_RULES: RulesDocument = {
  ...collectionYears(),
  stages: [
    { id: "identity", labels: { he: "תעודת זהות וספח", en: "ID and appendix" } },
    { id: "income", labels: { he: "הכנסה", en: "Income" } },
    { id: "banking", labels: { he: "עו״ש והלוואות", en: "Bank activity and loans" } },
  ],
  collectionStages: [{ id: "1", labels: { he: "מסמכים ראשונים", en: "First documents" } }],
  documents: {
    id_card: {
      labels: {
        he: "תעודת זהות",
        en: "ID card",
      },
      recognize:
        "Israeli identity card (תעודת זהות), front side. A photo or scan of the plastic card counts. The large page beside it is the appendix (ספח); the number and names are on the smaller card. The number is printed in groups such as 2 0570771 4. The given name (שם פרטי) and family name (שם משפחה) are separate lines.",
      fields: ["nationalId", "firstName", "lastName", "fullName", "biometric", "appendix"],
      checks: [
        { op: "field_present", field: "nationalId" },
        { op: "matches_profile", field: "nationalId", profileKey: "nationalId" },
      ],
    },
    id_card_back: {
      labels: { he: "הצד השני של תעודת הזהות", en: "other side of the ID card" },
      recognize:
        "The other side of an Israeli identity card (תעודת זהות), the back of the plastic card. Set docType to id_card_back only for that back. A driving licence (רישיון נהיגה), a passport, or any other card is not this document: leave docType empty.",
      fields: [],
      checks: [],
    },
    id_appendix: {
      labels: { he: "ספח תעודת זהות", en: "ID appendix" },
      recognize: "The Israeli ID appendix (ספח תעודת זהות), the paper page listing the household. A photo of that page is enough.",
      fields: [],
      checks: [],
    },
    payslip: {
      labels: { he: "תלוש שכר", en: "Payslip" },
      fields: ["fullName", "periodEnd"],
      checks: [
        { op: "field_present", field: "fullName" },
        { op: "date_within_months", field: "periodEnd", months: 3 },
      ],
    },
    tax_assessment: {
      labels: { he: "שומת מס", en: "Tax assessment" },
      fields: ["fullName", "year"],
      checks: [{ op: "field_present", field: "fullName" }],
    },
    accountant_letter: {
      labels: { he: "אישור רואה חשבון", en: "Accountant letter" },
      fields: ["fullName", "year"],
      checks: [{ op: "field_present", field: "fullName" }],
      blankForm: { file: "אישור רואה חשבון עוסק מורשה.pdf", once: "conversation" },
    },
    controlling_shareholder_letter: {
      labels: { he: "אישור רואה חשבון לבעל שליטה", en: "Controlling-shareholder accountant letter" },
      fields: [],
      checks: [],
      blankForm: { file: "אישור רואה חשבון לבעל שליטה (1).pdf", once: "conversation" },
    },
    bank_statement: {
      labels: { he: "תדפיס עו״ש", en: "Bank statement" },
      fields: ["months"],
      checks: [{ op: "prior_calendar_months", field: "months", months: 3 }],
    },
    loan_balances: {
      labels: { he: "יתרת הלוואות", en: "Loan balance" },
      fields: ["fullName"],
      checks: [{ op: "field_present", field: "fullName" }],
    },
  },
  requirements: stageOneRequirements(),
};

/** Income and banking stay closed for a non-first home and for an advisor flag. */
function listOpen(): { op: "all"; of: Condition[] } {
  return {
    op: "all",
    of: [
      { op: "neq", key: "firstHome", value: "false" },
      { op: "eq", key: "advisorFlag", value: "" },
    ],
  };
}

function whenEmployment(employment: Condition): Condition {
  return { op: "all", of: [...listOpen().of, employment] };
}

function stageOneRequirements(): Requirement[] {
  const open = listOpen();
  const salariedOrShareholder: Condition = {
    op: "any",
    of: [
      { op: "eq", key: "employment", value: "salaried" },
      { op: "eq", key: "employment", value: "controlling_shareholder" },
    ],
  };
  return [
    { docType: "id_card", stage: "identity", each: "borrower" },
    {
      docType: "id_card_back",
      stage: "identity",
      each: "borrower",
      when: { op: "eq", key: "idBiometric", value: "yes" },
    },
    { docType: "id_appendix", stage: "identity", each: "borrower" },
    { docType: "payslip", stage: "income", count: 3, each: "borrower", when: whenEmployment(salariedOrShareholder) },
    {
      docType: "controlling_shareholder_letter",
      stage: "income",
      each: "borrower",
      when: whenEmployment({ op: "eq", key: "employment", value: "controlling_shareholder" }),
    },
    {
      docType: "tax_assessment",
      stage: "income",
      each: "borrower",
      year: "taxYear",
      when: whenEmployment({ op: "eq", key: "employment", value: "self_employed" }),
    },
    {
      docType: "accountant_letter",
      stage: "income",
      each: "borrower",
      year: "accountantYear",
      when: whenEmployment({ op: "eq", key: "employment", value: "self_employed" }),
    },
    { docType: "bank_statement", stage: "banking", each: "account", empty: "one", months: 3, when: open },
    {
      docType: "loan_balances",
      stage: "banking",
      countFrom: "loanCount",
      when: { op: "all", of: [...open.of, { op: "eq", key: "loans", value: "known" }] },
    },
  ];
}

function borrowerScope(profile: Profile, borrower: BorrowerFact): Profile {
  const employment = borrower.employmentSource === "customer"
    ? borrower.employment
    : borrower.statusReport === "3"
      ? "controlling_shareholder"
      : borrower.employment;
  return {
    ...profile,
    employment,
    employmentLabel: borrower.employmentLabel,
    idBiometric: borrower.idBiometric,
    nationalId: borrower.nationalId || profile.nationalId,
    fullName: borrower.fullName || profile.fullName,
    phone: borrower.phone || profile.phone,
  };
}

function resolvedYear(requirement: Requirement, rules: RulesDocument): number | undefined {
  if (requirement.year === "taxYear") return rules.taxYear ?? collectionYears().taxYear;
  if (requirement.year === "accountantYear") return rules.accountantYear ?? collectionYears().accountantYear;
  return undefined;
}

/** One slot per saved requirement row, repeated for each borrower or account the row names. */
export function expandRequirements(profile: Profile, rules: RulesDocument): Slot[] {
  const normalized = ensureBorrowers(profile);
  const borrowers = borrowersOf(normalized);
  const stageOrder = new Map(rules.stages.map((stage, index) => [stage.id, index]));
  const ranked = [...rules.requirements].sort(
    (a, b) => (stageOrder.get(a.stage) ?? 0) - (stageOrder.get(b.stage) ?? 0),
  );
  const slots: Slot[] = [];
  for (const requirement of ranked) {
    const year = resolvedYear(requirement, rules);
    const months = requirement.months ? priorCalendarMonths(new Date(), requirement.months) : undefined;
    const dated = {
      ...(year ? { year } : {}),
      ...(months ? { months } : {}),
    };
    if (requirement.each === "borrower") {
      for (const borrower of borrowers) {
        if (!conditionMatches(requirement.when, borrowerScope(normalized, borrower))) continue;
        const count = requirement.count ?? 1;
        for (let index = 0; index < count; index += 1) {
          slots.push({
            id: `${requirement.docType}#${borrower.slot}#${year ?? index}`,
            docType: requirement.docType,
            stage: requirement.stage,
            index,
            collectionStage: requirement.collectionStage ?? "1",
            borrower: borrower.slot,
            ...dated,
          });
        }
      }
      continue;
    }
    if (!conditionMatches(requirement.when, normalized)) continue;
    if (requirement.each === "account") {
      const accounts = accountsOf(normalized);
      const list = accounts.length ? accounts : requirement.empty === "one" ? [{ id: "account" }] : [];
      for (const account of list) {
        slots.push({
          id: `${requirement.docType}#${account.id}#0`,
          docType: requirement.docType,
          stage: requirement.stage,
          index: 0,
          collectionStage: requirement.collectionStage ?? "1",
          ...(accounts.length ? { accountId: account.id } : {}),
          ...dated,
        });
      }
      continue;
    }
    const count = requirement.countFrom === "loanCount" ? loanCountOf(normalized) : requirement.count ?? 1;
    const scope = requirement.countFrom === "loanCount" ? "case" : "";
    for (let index = 0; index < count; index += 1) {
      slots.push({
        id: scope ? `${requirement.docType}#${scope}#${index}` : `${requirement.docType}#${index}`,
        docType: requirement.docType,
        stage: requirement.stage,
        index,
        collectionStage: requirement.collectionStage ?? "1",
        ...dated,
      });
    }
  }
  return slots;
}

export function releasedStageId(profile: Profile): string {
  const id = profile.releasedStageId;
  return typeof id === "string" && id.trim() ? id.trim() : "1";
}

export function nextCollectionStageId(rules: RulesDocument, current: string): string {
  const stages = rules.collectionStages?.length
    ? rules.collectionStages
    : [{ id: "1", labels: { he: "שלב 1", en: "Stage 1" } }];
  const index = stages.findIndex((stage) => stage.id === current);
  if (index < 0) return "";
  return stages[index + 1]?.id ?? "";
}

/** Slots for the collection wave that is open. The rows come from the saved rules. */
export function checklistSlots(profile: Profile, rules: RulesDocument): Slot[] {
  const normalized = ensureBorrowers(profile);
  if (factsOpen(normalized)) return [];
  const released = releasedStageId(normalized);
  return expandRequirements(normalized, rules).filter((slot) => (slot.collectionStage ?? "1") === released);
}
