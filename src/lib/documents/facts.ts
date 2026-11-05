import type { Profile } from "./rules";

/** What the checklist can act on. Empty `status_report` stays unknown. */
export type Employment = "salaried" | "self_employed" | "both" | "unknown";

export type LoansFact = "known" | "none" | "unknown";

export type FirstHome = "true" | "false" | "unknown";

export type BorrowerFact = {
  slot: "1" | "2";
  nationalId: string;
  fullName: string;
  phone: string;
  /** Raw `status_report_*` value. Empty is not code 0. */
  statusReport: string;
  employment: Employment;
  employmentLabel: string;
  employmentSource: "status_report" | "customer" | "profile" | "";
  employmentAnsweredAt: string;
  /** Code 3 only: whether the payslip salary lands in this borrower's account. */
  salaryDeposit: "yes" | "no" | "";
};

export type AccountFact = { id: string };

export type OpenQuestion =
  | { kind: "employment"; name: string }
  | { kind: "salary_deposit"; name: string }
  | { kind: "first_home" }
  | { kind: "loans" }
  | { kind: "accounts" }
  | { kind: "more_loans" }
  | { kind: "more_photos" };

const STATUS_REPORT: Record<string, { employment: Employment; label: string }> = {
  "0": { employment: "self_employed", label: "עצמאי/ת" },
  "1": { employment: "salaried", label: "שכיר/ה" },
  "2": { employment: "salaried", label: "מגזר ציבורי" },
  "3": { employment: "salaried", label: "שכיר/ה בעל שליטה" },
  "4": { employment: "unknown", label: "לא מועסק/ת" },
  "5": { employment: "both", label: "שכיר ועצמאי" },
  "6": { employment: "unknown", label: "מלגה" },
  "7": { employment: "unknown", label: "קצבה" },
  "8": { employment: "unknown", label: "פנסיונר/ית" },
  "9": { employment: "unknown", label: "אישור מוסד תורני" },
};

export function employmentFromStatusReport(raw: string): { employment: Employment; label: string } {
  const code = raw.trim();
  if (!code) return { employment: "unknown", label: "" };
  return STATUS_REPORT[code] ?? { employment: "unknown", label: code };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function borrowersOf(profile: Profile): BorrowerFact[] {
  if (!Array.isArray(profile.borrowers)) return [];
  return profile.borrowers.filter(isRecord).map((row) => ({
    slot: row.slot === "2" ? "2" : "1",
    nationalId: text(row.nationalId),
    fullName: text(row.fullName),
    phone: text(row.phone),
    statusReport: text(row.statusReport),
    employment: employmentValue(row.employment),
    employmentLabel: text(row.employmentLabel),
    employmentSource: sourceValue(row.employmentSource),
    employmentAnsweredAt: text(row.employmentAnsweredAt),
    salaryDeposit: row.salaryDeposit === "yes" || row.salaryDeposit === "no" ? row.salaryDeposit : "",
  }));
}

function employmentValue(value: unknown): Employment {
  if (value === "salaried" || value === "self_employed" || value === "both" || value === "unknown") return value;
  return "unknown";
}

function sourceValue(value: unknown): BorrowerFact["employmentSource"] {
  if (value === "status_report" || value === "customer" || value === "profile") return value;
  return "";
}

export function loansOf(profile: Profile): LoansFact {
  if (profile.loans === "known" || profile.loans === "none" || profile.loans === "unknown") return profile.loans;
  if (profile.hasLoans === true) return "known";
  return "unknown";
}

export function firstHomeOf(profile: Profile): FirstHome {
  if (profile.firstHome === "true" || profile.firstHome === "false" || profile.firstHome === "unknown") {
    return profile.firstHome;
  }
  return "unknown";
}

export function accountsOf(profile: Profile): AccountFact[] {
  if (!Array.isArray(profile.accounts)) return [];
  return profile.accounts.filter(isRecord).flatMap((row) => {
    const id = text(row.id);
    return id ? [{ id }] : [];
  });
}

export function accountsKnown(profile: Profile): LoansFact {
  if (profile.accountsKnown === "known" || profile.accountsKnown === "none" || profile.accountsKnown === "unknown") {
    return profile.accountsKnown;
  }
  return accountsOf(profile).length > 0 ? "known" : "unknown";
}

/** Case-level reason to hand the income list to the advisor. Empty when the two lists still apply. */
export function advisorReason(profile: Profile): string {
  if (firstHomeOf(profile) === "false") return "לא דירה ראשונה";
  const both = borrowersOf(profile).filter((borrower) => borrower.employment === "both");
  if (!both.length) return "";
  return both
    .map((borrower) => `${borrower.fullName || borrower.slot}: ${borrower.employmentLabel || "שכיר ועצמאי"}`)
    .join(", ");
}

export function openQuestions(profile: Profile): OpenQuestion[] {
  const questions: OpenQuestion[] = [];
  for (const borrower of borrowersOf(profile)) {
    if (borrower.employment === "unknown") {
      questions.push({ kind: "employment", name: borrower.fullName });
    }
    if (needsSalaryDeposit(borrower)) {
      questions.push({ kind: "salary_deposit", name: borrower.fullName });
    }
  }
  if (firstHomeOf(profile) === "unknown") questions.push({ kind: "first_home" });
  if (profile.imageBatchSlot) questions.push({ kind: "more_photos" });
  if (advisorReason(profile)) return questions;
  if (accountsKnown(profile) === "unknown") questions.push({ kind: "accounts" });
  if (loansOf(profile) === "unknown") questions.push({ kind: "loans" });
  if (profile.loanMore === "pending") questions.push({ kind: "more_loans" });
  return questions;
}

export function needsSalaryDeposit(borrower: BorrowerFact): boolean {
  return borrower.statusReport === "3" && borrower.salaryDeposit !== "yes" && borrower.salaryDeposit !== "no";
}

/** How many loan-balance files are open. Grows by one each time the customer says another is needed. */
export function loanCountOf(profile: Profile): number {
  const count = profile.loanCount;
  if (typeof count === "number" && Number.isFinite(count) && count >= 1) return Math.floor(count);
  return 1;
}

function legacyEmployment(raw: Record<string, unknown>): Employment | null {
  const value = text(raw.employment ?? raw.employmentType ?? raw.employment_type);
  if (value === "self_employed" || value === "עצמאי") return "self_employed";
  if (value === "salaried" || value === "employed" || value === "שכיר") return "salaried";
  if (value === "both") return "both";
  return null;
}

function personName(raw: Record<string, unknown>, slot: "1" | "2"): string {
  const joined = `${text(raw[`firstname_${slot}`])} ${text(raw[`lastname_${slot}`])}`.trim();
  return joined || (slot === "1" ? text(raw.fullName) || text(raw.full_name) || text(raw.name) : "");
}

function readBorrower(raw: Record<string, unknown>, slot: "1" | "2"): BorrowerFact | null {
  const nationalId = digits(text(raw[`id_${slot}`]) || (slot === "1" ? text(raw.nationalId) || text(raw.national_id) || text(raw.tz) || text(raw.idNumber) : ""));
  const phone = text(raw[`phone_${slot}`]) || (slot === "1" ? text(raw.phone) : "");
  const fullName = personName(raw, slot);
  if (slot === "2") {
    const firstId = digits(text(raw.id_1) || text(raw.nationalId) || text(raw.tz));
    if (nationalId && firstId && nationalId === firstId) return null;
    if (!nationalId && !phone) return null;
  } else if (!nationalId && !phone && !fullName) {
    return null;
  }
  const statusReport = text(raw[`status_report_${slot}`]);
  const decoded = employmentFromStatusReport(statusReport);
  const legacy = slot === "1" && !statusReport ? legacyEmployment(raw) : null;
  const employment = legacy ?? decoded.employment;
  return {
    slot,
    nationalId,
    fullName,
    phone,
    statusReport,
    employment,
    employmentLabel: legacy ? "" : decoded.label,
    employmentSource: legacy ? "profile" : statusReport ? "status_report" : "",
    employmentAnsweredAt: "",
    salaryDeposit: "",
  };
}

function loansFromRaw(raw: Record<string, unknown>): LoansFact {
  if (typeof raw.hasLoans === "boolean") return raw.hasLoans ? "known" : "none";
  if (typeof raw.has_loans === "boolean") return raw.has_loans ? "known" : "none";
  if (Array.isArray(raw.loans) && raw.loans.length > 0) return "known";
  if (Array.isArray(raw.liabilities) && raw.liabilities.length > 0) return "known";
  const amount = Number(text(raw.current_mortgage).replace(/,/g, ""));
  if (Number.isFinite(amount) && amount > 0) return "known";
  return "unknown";
}

function accountsFromRaw(raw: Record<string, unknown>): AccountFact[] {
  if (!Array.isArray(raw.banks_accounts)) return [];
  const seen = new Set<string>();
  const accounts: AccountFact[] = [];
  for (const row of raw.banks_accounts) {
    if (!isRecord(row)) continue;
    const id = text(row.uuid) || text(row.id) || text(row.account_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    accounts.push({ id });
  }
  return accounts;
}

/** Facts the checklist reads. Flat keys stay for the first borrower so checks still match. */
export function factsFromClient(raw: Record<string, unknown>): Profile {
  const borrowers = (["1", "2"] as const)
    .map((slot) => readBorrower(raw, slot))
    .filter((borrower): borrower is BorrowerFact => Boolean(borrower));
  const first = borrowers[0];
  const loans = loansFromRaw(raw);
  const accounts = accountsFromRaw(raw);
  const profile: Profile = {
    employment: first && first.employment !== "unknown" ? first.employment : "",
    employmentCode: first?.statusReport ?? "",
    employmentLabel: first?.employmentLabel ?? "",
    hasLoans: loans === "known",
    loans,
    firstHome: "unknown",
    nationalId: first?.nationalId ?? "",
    fullName: first?.fullName ?? "",
    phone: first?.phone ?? "",
    borrowers,
    accounts,
    accountsKnown: accounts.length > 0 ? "known" : "unknown",
    advisorFlag: "",
    advisorNotified: false,
    accountantFormSent: false,
    accountantFormPending: false,
  };
  profile.advisorFlag = advisorReason(profile);
  return profile;
}

function employmentAnswer(text: string): Employment | null {
  const folded = text.toLowerCase();
  if (/גם וגם|שכיר ועצמאי|\bboth\b/.test(folded)) return "both";
  if (/עצמאי|self[-\s]?employed/.test(folded)) return "self_employed";
  if (/שכיר|\bsalaried\b|\bemployed\b/.test(folded)) return "salaried";
  return null;
}

function mentions(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}

function onlyQuestion(profile: Profile, kind: OpenQuestion["kind"]): boolean {
  const pending = openQuestions(profile);
  return pending.length === 1 && pending[0]?.kind === kind;
}

function salaryDepositAnswer(message: string): "yes" | "no" | null {
  const folded = message.toLowerCase();
  if (/לא מופקד|לא מפקיד|אינה מופקד|not deposited|isn't deposited|does not deposit/.test(folded)) return "no";
  if (/מופקד|מפקיד|deposited|deposit/.test(folded)) return "yes";
  return null;
}

function moreLoansAnswer(message: string): "yes" | "no" | null {
  const folded = message.toLowerCase();
  if (/אין (?:עוד|הלוואות נוספות)|no more loans|no other loans/.test(folded)) return "no";
  if (/הלוואות נוספות|עוד הלוואה|another loan|more loans/.test(folded)) return "yes";
  return null;
}

/**
 * Apply one customer reply to facts that are still unknown.
 * A decoded employment code is left as-is: we only asked because it was unknown.
 */
export function applyCustomerAnswers(profile: Profile, message: string, now: Date = new Date()): { profile: Profile; changed: boolean } {
  const text = message.trim();
  if (!text) return { profile, changed: false };
  const next: Profile = {
    ...profile,
    borrowers: borrowersOf(profile).map((borrower) => ({ ...borrower })),
    accounts: accountsOf(profile).map((account) => ({ ...account })),
  };
  let changed = false;
  const borrowers = borrowersOf(next);
  const employment = employmentAnswer(text);
  if (employment) {
    const target = borrowers.find((borrower) => borrower.employment === "unknown");
    if (target) {
      target.employment = employment;
      target.employmentSource = "customer";
      target.employmentAnsweredAt = now.toISOString();
      if (!target.employmentLabel) {
        target.employmentLabel = employment === "salaried" ? "שכיר/ה" : employment === "self_employed" ? "עצמאי/ת" : "שכיר ועצמאי";
      }
      changed = true;
    }
  }
  if (firstHomeOf(next) === "unknown" && mentions(text, /דירה ה?ראשונה|first home/)) {
    next.firstHome = mentions(text, /לא דירה|not (?:a |our )?first/) ? "false" : "true";
    changed = true;
  } else if (firstHomeOf(next) === "unknown" && /^(כן|לא|yes|no)[.!?\s]*$/i.test(text)) {
    const pending = openQuestions(profile);
    const onlyFirstHome = pending.some((question) => question.kind === "first_home") && pending.length === 1;
    if (onlyFirstHome) {
      next.firstHome = /^(לא|no)/i.test(text) ? "false" : "true";
      changed = true;
    }
  }
  if (loansOf(next) === "unknown" && mentions(text, /הלווא|loans?/)) {
    next.loans = mentions(text, /אין הלווא|no loans|without loans/) ? "none" : "known";
    next.hasLoans = next.loans === "known";
    changed = true;
  }
  if (accountsKnown(next) === "unknown" && mentions(text, /חשבון|חשבונות|accounts?/)) {
    next.accountsKnown = mentions(text, /אין חשבון|אין חשבונות|no accounts/) ? "none" : "known";
    changed = true;
  }
  const depositTarget = borrowers.find((borrower) => needsSalaryDeposit(borrower));
  const deposit = depositTarget ? salaryDepositAnswer(text) : null;
  if (depositTarget && deposit) {
    depositTarget.salaryDeposit = deposit;
    changed = true;
  } else if (depositTarget && /^(כן|לא|yes|no)[.!?\s]*$/i.test(text) && onlyQuestion(profile, "salary_deposit")) {
    depositTarget.salaryDeposit = /^(לא|no)/i.test(text) ? "no" : "yes";
    changed = true;
  }
  if (profile.loanMore === "pending") {
    const more = moreLoansAnswer(text);
    const bare = /^(כן|לא|yes|no)[.!?\s]*$/i.test(text) && onlyQuestion(profile, "more_loans");
    if (more || bare) {
      const no = more === "no" || (bare && /^(לא|no)/i.test(text));
      if (no) next.loanMore = "no";
      else {
        next.loanCount = loanCountOf(next) + 1;
        next.loanMore = "";
      }
      changed = true;
    }
  }
  next.borrowers = borrowers;
  if (changed) {
    const first = borrowers[0];
    if (first) {
      next.employment = first.employment === "unknown" ? "" : first.employment;
      next.employmentLabel = first.employmentLabel;
    }
    next.advisorFlag = advisorReason(next);
  }
  return { profile: next, changed };
}
