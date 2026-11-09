import type { Profile } from "./rules";

/** What the checklist can act on. Empty `status_report` stays unknown. */
export type Employment =
  | "salaried"
  | "self_employed"
  | "controlling_shareholder"
  | "both"
  | "other"
  | "unknown";

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
  /** Set after the customer says whether this ID card is biometric. */
  idBiometric: "yes" | "no" | "";
};

export type AccountFact = { id: string };

export type OpenQuestion =
  | { kind: "second_borrower" }
  | { kind: "couple_split" }
  | { kind: "employment"; name: string; slot: "1" | "2" }
  | { kind: "salary_deposit"; name: string }
  | { kind: "first_home" }
  | { kind: "loans" }
  | { kind: "accounts" }
  | { kind: "more_loans" }
  | { kind: "more_photos" }
  | { kind: "id_biometric"; name: string; slot: "1" | "2" }
  | { kind: "id_back"; name: string; slot: "1" | "2" };

const STATUS_REPORT: Record<string, { employment: Employment; label: string }> = {
  "0": { employment: "self_employed", label: "עצמאי/ת" },
  "1": { employment: "salaried", label: "שכיר/ה" },
  "2": { employment: "salaried", label: "מגזר ציבורי" },
  "3": { employment: "controlling_shareholder", label: "שכיר/ה בעל שליטה" },
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
    idBiometric: row.idBiometric === "yes" || row.idBiometric === "no" ? row.idBiometric : "",
  }));
}

function employmentValue(value: unknown): Employment {
  if (
    value === "salaried" ||
    value === "self_employed" ||
    value === "controlling_shareholder" ||
    value === "both" ||
    value === "other" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function sourceValue(value: unknown): BorrowerFact["employmentSource"] {
  if (value === "status_report" || value === "customer" || value === "profile") return value;
  return "";
}

/**
 * They are refusing the file that was just requested, not saying the underlying thing does not exist.
 * "אין לי" after "send the loan balance" means the document is not in hand.
 */
export function missingTheDocument(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/מסמך|קובץ|יתרת?|אישור|תדפיס|תלוש|צילום|תעודה|document|file|statement|payslip/i.test(value) && /אין|לא נמצא|don'?t have|do not have|cannot find|can't find/i.test(value)) {
    return true;
  }
  return /^(אין לי|אין|לא נמצא אצלי|אין לי את זה)[.!?\s]*$/i.test(value)
    || /^(i )?don'?t have (it|one|this|that)[.!?\s]*$/i.test(value);
}

/** They named loans and said there are none. A missing balance document is not this. */
export function declinesExistingLoans(text: string): boolean {
  if (missingTheDocument(text)) return false;
  if (/נוספ|another|more loan/i.test(text)) return false;
  if (/יש (לי )?הלווא|have loans|i have (a )?loan/i.test(text)) return false;
  return /אין (לי )?(שום )?הלווא|בלי הלווא|no loans|without loans|don'?t have (any )?loans|do not have (any )?loans/i.test(text);
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

/** One person on the file, and the customer has not said whether anyone else is borrowing. */
export function secondBorrowerOf(profile: Profile): "yes" | "no" | "unknown" {
  if (borrowersOf(profile).some((borrower) => borrower.slot === "2")) return "yes";
  if (profile.secondBorrower === "no") return "no";
  return "unknown";
}

/** Case-level reason to hand the income list to the advisor. Empty when the two lists still apply. */
export function advisorReason(profile: Profile): string {
  if (firstHomeOf(profile) === "false") return "לא דירה ראשונה";
  const flagged = borrowersOf(profile).filter(
    (borrower) => borrower.employment === "both" || borrower.employment === "other",
  );
  if (!flagged.length) return "";
  return flagged
    .map((borrower) => `${borrower.fullName || borrower.slot}: ${borrower.employmentLabel || "אחר"}`)
    .join(", ");
}

export function blankBorrower(slot: "1" | "2" = "2"): BorrowerFact {
  return {
    slot,
    nationalId: "",
    fullName: "",
    phone: "",
    statusReport: "",
    employment: "unknown",
    employmentLabel: "",
    employmentSource: "",
    employmentAnsweredAt: "",
    salaryDeposit: "",
    idBiometric: "",
  };
}

/** A file with nobody on it still has borrower 1, so the personal questions are asked. */
export function ensureBorrowers(profile: Profile): Profile {
  if (borrowersOf(profile).length > 0) return profile;
  return { ...profile, borrowers: [blankBorrower("1")] };
}

export function openQuestions(profile: Profile): OpenQuestion[] {
  const current = ensureBorrowers(profile);
  const questions: OpenQuestion[] = [];
  const borrowers = borrowersOf(current);
  if (secondBorrowerOf(current) === "unknown" && borrowers.length > 0) {
    questions.push({ kind: "second_borrower" });
  }
  const two = borrowers.some((borrower) => borrower.slot === "2");
  const employmentUnknown = borrowers.some((borrower) => borrower.employment === "unknown");
  if (two && employmentUnknown && current.coupleSplit !== "yes" && current.coupleSplit !== "no") {
    questions.push({ kind: "couple_split" });
  }
  for (const borrower of borrowers) {
    if (borrower.employment === "unknown") {
      questions.push({ kind: "employment", name: borrower.fullName, slot: borrower.slot });
    }
  }
  if (firstHomeOf(current) === "unknown") questions.push({ kind: "first_home" });
  if (current.imageBatchSlot) {
    const back = current.idBackPending === "1" || current.idBackPending === "2" ? current.idBackPending : "";
    const borrower = borrowers.find((item) => item.slot === back);
    questions.push(back
      ? { kind: "id_back", name: borrower?.fullName ?? "", slot: back }
      : { kind: "more_photos" });
  }
  if (advisorReason(current)) return withIdSide(questions, current, borrowers);
  if (loansOf(current) === "unknown") questions.push({ kind: "loans" });
  if (current.loanMore === "pending") questions.push({ kind: "more_loans" });
  return withIdSide(questions, current, borrowers);
}

function withIdSide(questions: OpenQuestion[], profile: Profile, borrowers: BorrowerFact[]): OpenQuestion[] {
  const pending = profile.askIdBiometric === "1" || profile.askIdBiometric === "2" ? profile.askIdBiometric : "";
  if (!pending) return questions;
  const borrower = borrowers.find((item) => item.slot === pending);
  if (!borrower || borrower.idBiometric === "yes" || borrower.idBiometric === "no") return questions;
  return [...questions, { kind: "id_biometric", name: borrower.fullName, slot: pending }];
}

const FACT_KINDS = new Set(["second_borrower", "couple_split", "employment", "first_home", "loans"]);

/** Borrower count, employment, first home, and loans. Photos and extra loans are not in this gate. */
export function factsOpen(profile: Profile): boolean {
  return openQuestions(profile).some((question) => FACT_KINDS.has(question.kind));
}

/** The card itself says whether it is biometric. That opens the other side. */
export function applyExtractedBiometric(profile: Profile, slot: "1" | "2", value: string): Profile {
  if (value !== "yes" && value !== "no") return profile;
  const borrowers = borrowersOf(ensureBorrowers(profile)).map((borrower) =>
    borrower.slot === slot ? { ...borrower, idBiometric: value } : borrower,
  );
  return { ...profile, borrowers, askIdBiometric: "" };
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
    idBiometric: "",
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
    formPending: "",
  };
  profile.advisorFlag = advisorReason(profile);
  return ensureBorrowers(profile);
}

function employmentAnswer(text: string): Employment | null {
  const folded = text.toLowerCase();
  if (/גם וגם|שכיר ועצמאי|\bboth\b/.test(folded)) return "both";
  if (/בעל שליטה|controlling shareholder/.test(folded)) return "controlling_shareholder";
  if (/אחר|\bother\b/.test(folded)) return "other";
  if (/עצמאי|self[-\s]?employed/.test(folded)) return "self_employed";
  if (/שכיר|\bsalaried\b|\bemployed\b/.test(folded)) return "salaried";
  return null;
}

function employmentLabelFor(employment: Employment): string {
  if (employment === "salaried") return "שכיר/ה";
  if (employment === "self_employed") return "עצמאי/ת";
  if (employment === "controlling_shareholder") return "שכיר/ה בעל שליטה";
  if (employment === "other") return "אחר";
  return "שכיר ועצמאי";
}

function mentions(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}

/** The one question this turn should ask. Later questions wait for its answer. */
export function nextQuestion(profile: Profile): OpenQuestion | undefined {
  return openQuestions(profile)[0];
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
export function applyCustomerAnswers(
  input: Profile,
  message: string,
  now: Date = new Date(),
  opts?: { bare?: boolean },
): { profile: Profile; changed: boolean } {
  const text = message.trim();
  const profile = ensureBorrowers(input);
  if (!text) return { profile, changed: profile !== input };
  const next: Profile = {
    ...profile,
    borrowers: borrowersOf(profile).map((borrower) => ({ ...borrower })),
    accounts: accountsOf(profile).map((account) => ({ ...account })),
  };
  let changed = false;
  const borrowers = borrowersOf(next);
  const asked = nextQuestion(profile)?.kind;
  if (asked === "second_borrower" && secondBorrowerOf(next) === "unknown") {
    const folded = text.toLowerCase();
    const bareNo = /^(?:לא|no)[.!?\s]*$/i.test(text);
    const bareYes = /^(?:כן|yes)[.!?\s]*$/i.test(text);
    const no = bareNo || /אין לווה|אין עוד|רק אני|only me|no other|no second/.test(folded);
    const yes = bareYes || /לווה נוסף|עוד לווה|שני לווים|second borrower|another borrower/.test(folded);
    if (no || (yes && !no)) {
      next.secondBorrower = no ? "no" : "yes";
      if (!no && !borrowers.some((borrower) => borrower.slot === "2")) borrowers.push(blankBorrower("2"));
      changed = true;
    }
  }
  if (asked === "couple_split" && next.coupleSplit !== "yes" && next.coupleSplit !== "no") {
    const yes = /^(?:כן|yes)[.!?\s]*$/i.test(text) || /אישה שכיר|wife is salaried|husband is self/.test(text.toLowerCase());
    const no = /^(?:לא|no)[.!?\s]*$/i.test(text);
    if (yes || no) {
      next.coupleSplit = no ? "no" : "yes";
      if (!no) {
        for (const borrower of borrowers) {
          if (borrower.employment !== "unknown" || borrower.employmentSource === "status_report") continue;
          const employment = borrower.slot === "2" ? "self_employed" : "salaried";
          borrower.employment = employment;
          borrower.employmentLabel = employmentLabelFor(employment);
          borrower.employmentSource = "customer";
          borrower.employmentAnsweredAt = now.toISOString();
        }
      }
      changed = true;
    }
  }
  if (asked === "id_biometric") {
    const slot = profile.askIdBiometric === "2" ? "2" : "1";
    const yes = /^(?:כן|yes)[.!?\s]*$/i.test(text) || /ביומטר|biometric/.test(text.toLowerCase());
    const no = /^(?:לא|no)[.!?\s]*$/i.test(text) || /לא ביומטר|not biometric/.test(text.toLowerCase());
    if (yes || no) {
      const borrower = borrowers.find((item) => item.slot === slot);
      if (borrower) borrower.idBiometric = no ? "no" : "yes";
      next.askIdBiometric = "";
      changed = true;
    }
  }
  const employment = employmentAnswer(text);
  if (employment && asked === "employment") {
    const target = borrowers.find((borrower) => borrower.employment === "unknown");
    if (target) {
      target.employment = employment;
      target.employmentSource = "customer";
      target.employmentAnsweredAt = now.toISOString();
      target.employmentLabel = employmentLabelFor(employment);
      changed = true;
    }
  }
  const bareYesNo = opts?.bare !== false && /^(כן|לא|yes|no)[.!?\s]*$/i.test(text);
  const bareNo = /^(לא|no)/i.test(text);
  if (firstHomeOf(next) === "unknown" && mentions(text, /דירה ה?ראשונה|first home/)) {
    next.firstHome = mentions(text, /לא דירה|not (?:a |our )?first/) ? "false" : "true";
    changed = true;
  } else if (asked === "first_home" && firstHomeOf(next) === "unknown" && bareYesNo) {
    next.firstHome = bareNo ? "false" : "true";
    changed = true;
  }
  if (loansOf(next) === "unknown" && mentions(text, /הלווא|loans?/)) {
    next.loans = mentions(text, /אין הלווא|no loans|without loans/) ? "none" : "known";
    next.hasLoans = next.loans === "known";
    changed = true;
  } else if (asked === "loans" && loansOf(next) === "unknown" && (bareYesNo || missingTheDocument(text))) {
    next.loans = bareNo || missingTheDocument(text) ? "none" : "known";
    next.hasLoans = next.loans === "known";
    changed = true;
  }
  if (declinesExistingLoans(text)) {
    next.loans = "none";
    next.hasLoans = false;
    next.loanMore = "no";
    changed = true;
  }
  const depositTarget = borrowers.find((borrower) => needsSalaryDeposit(borrower));
  const deposit = depositTarget ? salaryDepositAnswer(text) : null;
  if (depositTarget && deposit) {
    depositTarget.salaryDeposit = deposit;
    changed = true;
  } else if (depositTarget && bareYesNo && asked === "salary_deposit") {
    depositTarget.salaryDeposit = bareNo ? "no" : "yes";
    changed = true;
  }
  if (profile.loanMore === "pending") {
    const more = moreLoansAnswer(text);
    const bare = bareYesNo && asked === "more_loans";
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
