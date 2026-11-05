import {
  accountsKnown,
  accountsOf,
  advisorReason,
  borrowersOf,
  firstHomeOf,
  loanCountOf,
  loansOf,
  needsSalaryDeposit,
  type BorrowerFact,
} from "./facts";
import { requiredSlots, type Profile, type RulesDocument, type Slot } from "./rules";

/** Current calendar year is the accountant letter. The year before it is the prior-year pair. */
export function collectionYears(now: Date = new Date()): { taxYear: number; accountantYear: number } {
  const accountantYear = now.getFullYear();
  return { accountantYear, taxYear: accountantYear - 1 };
}

/**
 * Israeli mortgage file. Identity is always open. Income and banking
 * come from each borrower's employment, known accounts, and known loans.
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
  documents: {
    id_card: {
      labels: {
        he: "תעודת זהות (גם את הצד השני אם הכרטיס ביומטרי)",
        en: "ID card (both sides of a biometric card)",
      },
      fields: ["nationalId", "fullName"],
      checks: [
        { op: "field_present", field: "nationalId" },
        { op: "matches_profile", field: "nationalId", profileKey: "nationalId" },
      ],
    },
    id_appendix: {
      labels: { he: "ספח תעודת זהות", en: "ID appendix" },
      fields: ["fullName"],
      checks: [{ op: "field_present", field: "fullName" }],
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
      fields: ["fullName"],
      checks: [{ op: "field_present", field: "fullName" }],
    },
    accountant_letter: {
      labels: { he: "אישור רואה חשבון", en: "Accountant letter" },
      fields: ["fullName"],
      checks: [{ op: "field_present", field: "fullName" }],
    },
    controlling_shareholder_letter: {
      labels: { he: "אישור רואה חשבון לבעל שליטה", en: "Controlling-shareholder accountant letter" },
      fields: [],
      checks: [],
    },
    bank_statement: {
      labels: { he: "תדפיס עו״ש ל-3 חודשים", en: "Bank statement, last 3 months" },
      fields: ["periodEnd"],
      checks: [{ op: "date_within_months", field: "periodEnd", months: 3 }],
    },
    loan_balances: {
      labels: { he: "יתרת הלוואות", en: "Loan balance" },
      fields: ["fullName"],
      checks: [{ op: "field_present", field: "fullName" }],
    },
  },
  requirements: [
    { docType: "id_card", stage: "identity" },
    { docType: "id_appendix", stage: "identity" },
  ],
};

function slot(
  docType: string,
  stage: string,
  scope: string,
  index: number,
  borrower?: string,
  accountId?: string,
  extra?: { year?: number; altGroup?: string },
): Slot {
  return {
    id: `${docType}#${scope}#${index}`,
    docType,
    stage,
    index,
    ...(borrower ? { borrower } : {}),
    ...(accountId ? { accountId } : {}),
    ...(extra?.year ? { year: extra.year } : {}),
    ...(extra?.altGroup ? { altGroup: extra.altGroup } : {}),
  };
}

function incomeSlots(borrower: BorrowerFact, rules: RulesDocument): Slot[] {
  if (needsSalaryDeposit(borrower)) return [];
  if (borrower.employment === "salaried") {
    const slips = [0, 1, 2].map((index) => slot("payslip", "income", borrower.slot, index, borrower.slot));
    if (borrower.salaryDeposit === "no") {
      slips.push(slot("controlling_shareholder_letter", "income", borrower.slot, 0, borrower.slot));
    }
    return slips;
  }
  if (borrower.employment === "self_employed") {
    const years = collectionYears();
    const taxYear = rules.taxYear ?? years.taxYear;
    const accountantYear = rules.accountantYear ?? years.accountantYear;
    const group = `prior-income#${borrower.slot}`;
    return [
      slot("accountant_letter", "income", borrower.slot, accountantYear, borrower.slot, undefined, { year: accountantYear }),
      slot("tax_assessment", "income", borrower.slot, taxYear, borrower.slot, undefined, { year: taxYear, altGroup: group }),
      slot("accountant_letter", "income", `${borrower.slot}-prior`, taxYear, borrower.slot, undefined, {
        year: taxYear,
        altGroup: group,
      }),
    ];
  }
  return [];
}

/** Slots for a profile that already carries borrower facts. */
export function mortgageSlots(profile: Profile, rules: RulesDocument): Slot[] {
  const borrowers = borrowersOf(profile);
  const identity = borrowers.flatMap((borrower) => [
    slot("id_card", "identity", borrower.slot, 0, borrower.slot),
    slot("id_appendix", "identity", borrower.slot, 0, borrower.slot),
  ]);
  if (advisorReason(profile) || firstHomeOf(profile) === "false") return identity;
  const income = borrowers.flatMap((borrower) => incomeSlots(borrower, rules));
  const statements =
    accountsKnown(profile) === "known"
      ? accountsOf(profile).map((account) => slot("bank_statement", "banking", account.id, 0, undefined, account.id))
      : [];
  const askedAccount =
    accountsKnown(profile) === "known" && accountsOf(profile).length === 0
      ? [slot("bank_statement", "banking", "asked", 0)]
      : [];
  const loans =
    loansOf(profile) === "known"
      ? Array.from({ length: loanCountOf(profile) }, (_, index) => slot("loan_balances", "banking", "case", index))
      : [];
  return [...identity, ...income, ...statements, ...askedAccount, ...loans];
}

/**
 * Borrower facts use the mortgage generator. A profile without them
 * still follows the saved requirements list.
 */
export function checklistSlots(profile: Profile, rules: RulesDocument): Slot[] {
  if (Array.isArray(profile.borrowers)) return mortgageSlots(profile, rules);
  return requiredSlots(profile, rules);
}
