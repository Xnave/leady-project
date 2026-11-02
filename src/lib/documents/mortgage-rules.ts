import type { RulesDocument } from "./rules";

/**
 * First checklist: Israeli mortgage file.
 * Identity, then income (count follows employment), then bank activity
 * and loan balances only when the profile says loans exist.
 */
export const MORTGAGE_RULES: RulesDocument = {
  stages: [
    { id: "identity", labels: { he: "תעודת זהות וספח", en: "ID and appendix" } },
    { id: "income", labels: { he: "אישורי הכנסה", en: "Income confirmations" } },
    { id: "banking", labels: { he: "עו״ש והלוואות", en: "Bank activity and loans" } },
  ],
  documents: {
    id_card: {
      labels: { he: "תעודת זהות", en: "ID card" },
      fields: ["nationalId", "fullName"],
      checks: [
        { op: "field_present", field: "nationalId" },
        { op: "matches_profile", field: "nationalId", profileKey: "nationalId" },
      ],
    },
    id_appendix: {
      labels: { he: "ספח", en: "ID appendix" },
      fields: ["fullName"],
      checks: [{ op: "field_present", field: "fullName" }],
    },
    income_confirmation: {
      labels: { he: "אישור הכנסה", en: "Income confirmation" },
      fields: ["fullName", "periodEnd"],
      checks: [
        { op: "field_present", field: "fullName" },
        { op: "matches_profile", field: "fullName", profileKey: "fullName" },
        { op: "date_within_months", field: "periodEnd", months: 12 },
      ],
    },
    bank_statement: {
      labels: { he: "תדפיס עו״ש", en: "Bank statement" },
      fields: ["periodEnd"],
      checks: [{ op: "date_within_months", field: "periodEnd", months: 3 }],
    },
    loan_balances: {
      labels: { he: "יתרות הלוואות", en: "Loan balances" },
      fields: ["fullName"],
      checks: [{ op: "field_present", field: "fullName" }],
    },
  },
  requirements: [
    { docType: "id_card", stage: "identity" },
    { docType: "id_appendix", stage: "identity" },
    {
      docType: "income_confirmation",
      stage: "income",
      count: 1,
      when: { op: "eq", key: "employment", value: "employed" },
    },
    {
      docType: "income_confirmation",
      stage: "income",
      count: 2,
      when: { op: "eq", key: "employment", value: "self_employed" },
    },
    { docType: "bank_statement", stage: "banking", count: 3 },
    {
      docType: "loan_balances",
      stage: "banking",
      when: { op: "truthy", key: "hasLoans" },
    },
  ],
};

export const EMPLOYED_WITH_LOANS = {
  employment: "employed",
  hasLoans: true,
  nationalId: "123456782",
  fullName: "Dana Levi",
};

export const SELF_EMPLOYED_NO_LOANS = {
  employment: "self_employed",
  hasLoans: false,
  nationalId: "123456782",
  fullName: "Dana Levi",
};
