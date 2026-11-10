import { copyFor } from "@/lib/copy";
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
  | { kind: "split_who"; first: string; second: string }
  | { kind: "employment"; name: string; slot: "1" | "2" }
  | { kind: "salary_deposit"; name: string }
  | { kind: "first_home" }
  | { kind: "loans" }
  | { kind: "accounts" }
  | { kind: "more_loans" }
  | { kind: "more_photos" }
  | { kind: "id_appendix"; name: string; slot: "1" | "2" }
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

/** They named loans and said there are some. "הלוואה נוספת" is the extra-loan question. */
export function affirmsExistingLoans(text: string): boolean {
  if (missingTheDocument(text) || declinesExistingLoans(text)) return false;
  if (/נוספ|another|more loan|עוד הלוואה/i.test(text)) return false;
  return /יש (לי )?הלווא|have loans|i have (a )?loan/i.test(text);
}

/** The sentence marks a change, or it is the new answer itself. A bare "אין לי" is neither. */
export function correctionMarked(text: string): boolean {
  return /בעצם|התכוונתי|טעיתי|actually|i meant/i.test(text);
}

/** Where to get the open document, or that the last explanation was not clear. */
export function asksHowToGet(text: string): boolean {
  return /מאיפה|איך (אני )?משיג|איך מוריד|לאן (אני )?נכנס|לא הבנתי|where (do|can) i (get|find)|how do i get|which (site|page)|don'?t understand|do not understand/i.test(text);
}

/**
 * The last file was the wrong document. "אין לי" is still "I don't have this file".
 * An ordinary question does not reopen a slot.
 */
export function retractsLastFile(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (missingTheDocument(value) && !/רישיון|licen[cs]e|זה לא|not the/i.test(value)) return false;
  if (/זה לא (נטען|ברור|נכון|משנה|קשור)|not (charged|clear|sure)/i.test(value)) return false;
  if (/[?？]/.test(value) || /^(אם|האם|אפשר|can i|could i)\b/i.test(value)) return false;
  return /שלחתי בטעות|sent (the )?wrong|wrong (file|document|photo|side)|רישיון|driving licen|זה לא (ה)?(תעוד|מסמך|קובץ)|not the (right )?id|not an id/i.test(value);
}

export type FactRevisionKind =
  | "loans_known"
  | "employment"
  | "second_yes"
  | "second_no"
  | "first_home_yes"
  | "first_home_no"
  | "couple_yes"
  | "couple_no"
  | "split_who"
  | "salary_yes"
  | "salary_no"
  | "more_loans";

export type FactRevision = { kind: FactRevisionKind; detail?: string };

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

/**
 * Who a file belongs to when the case has two borrowers.
 * A name wins. Otherwise a unique employment, then first or second.
 * One borrower stays unnamed.
 */
export function borrowerFileWho(
  profile: Profile,
  borrower: string | undefined,
  lang: "en" | "he",
): string {
  const people = borrowersOf(profile);
  if (people.length < 2) return "";
  const slot = borrower === "2" ? "2" : borrower === "1" ? "1" : "";
  if (!slot) return "";
  const person = people.find((item) => item.slot === slot);
  if (!person) return "";
  const name = person.fullName.trim();
  if (name) return name;
  const documents = copyFor(lang).chat.documents;
  const employment = person.employment;
  const namedRole = employment === "salaried"
    || employment === "self_employed"
    || employment === "controlling_shareholder"
    || employment === "both";
  if (namedRole && people.filter((item) => item.employment === employment).length === 1) {
    return documents.borrowerRole[employment];
  }
  return documents.borrowerOrder[slot];
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
  for (const borrower of borrowers) {
    if (borrower.employment === "unknown") {
      questions.push({ kind: "employment", name: borrower.fullName, slot: borrower.slot });
    }
  }
  if (firstHomeOf(current) === "unknown") questions.push({ kind: "first_home" });
  if (current.imageBatchSlot) {
    const back = current.idBackPending === "1" || current.idBackPending === "2" ? current.idBackPending : "";
    const appendix = current.appendixPending === "1" || current.appendixPending === "2" ? current.appendixPending : "";
    const borrower = borrowers.find((item) => item.slot === (back || appendix));
    questions.push(back
      ? { kind: "id_back", name: borrower?.fullName ?? "", slot: back }
      : appendix
        ? { kind: "id_appendix", name: borrower?.fullName ?? "", slot: appendix }
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

const FACT_KINDS = new Set(["second_borrower", "couple_split", "split_who", "employment", "first_home", "loans"]);

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

/** "שנינו שכירים" names every borrower, including after a leading לא. */
export function sharedBorrowerEmployment(text: string): Employment | null {
  if (!/שנינו|שתינו|שני הלווים|both of us|we(?:'re| are) both/i.test(text)) return null;
  return employmentAnswer(text);
}

function employmentAnswer(text: string): Employment | null {
  const folded = text.toLowerCase();
  if (/שכיר וגם עצמאי|עצמאי וגם שכיר|גם וגם|שכיר ועצמאי|salaried and self/.test(folded)) return "both";
  if (/בעל שליטה|controlling shareholder/.test(folded)) return "controlling_shareholder";
  if (/(?:^|[\s,.])אחר(?:$|[\s,.!?])|\bother\b/.test(folded)) return "other";
  if (/עצמאי|self[-\s]?employed/.test(folded)) return "self_employed";
  if (/שכיר|\bsalaried\b|\bemployed\b/.test(folded)) return "salaried";
  if (/\bboth\b/.test(folded)) return "both";
  return null;
}

function idleQuestion(text: string): boolean {
  const value = text.trim();
  return /[?？]/.test(value)
    || /^(אם|האם|אפשר|can i|could i|what if)\b/i.test(value)
    || /זה משנה|does it matter/i.test(value);
}

function assignEmployment(borrower: BorrowerFact, employment: Employment, now: Date): void {
  borrower.employment = employment;
  borrower.employmentSource = "customer";
  borrower.employmentAnsweredAt = now.toISOString();
  borrower.employmentLabel = employmentLabelFor(employment);
}

/** Slot of the self-employed borrower when the pair is one salaried and one self-employed. */
export function splitWhoOf(profile: Profile): "1" | "2" | "" {
  const people = borrowersOf(profile);
  const self = people.filter((borrower) => borrower.employment === "self_employed");
  const salaried = people.filter((borrower) => borrower.employment === "salaried");
  if (self.length === 1 && salaried.length === 1 && (self[0]?.slot === "1" || self[0]?.slot === "2")) {
    return self[0].slot;
  }
  return "";
}

/** A yes to the mixed pair still needs this answer before either income list opens. */
function splitWhoAnswer(text: string, borrowers: BorrowerFact[]): "1" | "2" | null {
  const folded = text.trim().toLowerCase();
  const named = (slot: "1" | "2"): boolean => {
    const name = borrowers.find((borrower) => borrower.slot === slot)?.fullName.trim().toLowerCase() ?? "";
    if (name.length < 2) return false;
    if (folded.includes(name)) return true;
    return name.split(/\s+/).some((part) => part.length > 1 && folded.includes(part));
  };
  const first = named("1");
  const second = named("2");
  if (first && !second) return "1";
  if (second && !first) return "2";
  if (/השני|second borrower|the second/.test(folded)) return "2";
  if (/הראשון|first borrower|the first/.test(folded)) return "1";
  return null;
}

function assignSplit(borrowers: BorrowerFact[], selfSlot: "1" | "2", now: Date): string {
  const notes: string[] = [];
  for (const borrower of borrowers) {
    if (borrower.slot !== "1" && borrower.slot !== "2") continue;
    const employment: Employment = borrower.slot === selfSlot ? "self_employed" : "salaried";
    const fromReport = borrower.employmentSource === "status_report"
      && borrower.employment !== "unknown"
      && borrower.employment !== employment;
    const prior = borrower.employment;
    if (borrower.employment === employment && borrower.employmentSource === "customer") continue;
    assignEmployment(borrower, employment, now);
    if (fromReport) notes.push(employmentConflictText(prior, employment));
  }
  return notes.join(" ");
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
 * Apply one customer reply to a fact that is still unknown.
 * A stored answer changes only through applyFactIntents, after the message has been read.
 * A bare "אין לי" still means the file is not in hand.
 */
export function applyCustomerAnswers(
  input: Profile,
  message: string,
  now: Date = new Date(),
  opts?: { bare?: boolean },
): { profile: Profile; changed: boolean; revision?: FactRevision } {
  const text = message.trim();
  const profile = ensureBorrowers(input);
  if (!text) return { profile, changed: profile !== input };
  const next: Profile = {
    ...profile,
    borrowers: borrowersOf(profile).map((borrower) => ({ ...borrower })),
    accounts: accountsOf(profile).map((account) => ({ ...account })),
  };
  let changed = false;
  let revision: FactRevision | undefined;
  const borrowers = borrowersOf(next);
  const asked = nextQuestion(profile)?.kind;
  const priorSecond = secondBorrowerOf(profile);
  if (asked === "second_borrower" && priorSecond === "unknown") {
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
    const yes = /^(?:כן|yes)[.!?\s]*$/i.test(text);
    const no = /^(?:לא|no)[.!?\s]*$/i.test(text);
    if (yes || no) {
      next.coupleSplit = no ? "no" : "yes";
      changed = true;
    }
  }
  if (asked === "split_who" && splitWhoOf({ ...next, borrowers }) === "") {
    const selfSlot = splitWhoAnswer(text, borrowers);
    if (selfSlot) {
      const conflict = assignSplit(borrowers, selfSlot, now);
      if (conflict) next.employmentConflict = conflict;
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
  const shared = sharedBorrowerEmployment(text);
  const employment = employmentAnswer(text);
  if (shared && !idleQuestion(text)) {
    for (const borrower of borrowers) {
      if (borrower.employment !== "unknown") continue;
      assignEmployment(borrower, shared, now);
      changed = true;
    }
  } else if (employment && asked === "employment" && !idleQuestion(text)) {
    const question = nextQuestion(profile);
    const slot = question?.kind === "employment" ? question.slot : undefined;
    const target = borrowers.find((borrower) => borrower.slot === slot)
      ?? borrowers.find((borrower) => borrower.employment === "unknown");
    if (target && target.employment === "unknown") {
      assignEmployment(target, employment, now);
      changed = true;
    }
  }
  const bareYesNo = opts?.bare !== false && /^(כן|לא|yes|no)[.!?\s]*$/i.test(text);
  const bareNo = /^(לא|no)/i.test(text);
  if (firstHomeOf(next) === "unknown" && !idleQuestion(text) && mentions(text, /דירה ה?ראשונה|first home/)) {
    next.firstHome = mentions(text, /לא דירה|זו לא|זה לא|not (?:a |our )?first/) ? "false" : "true";
    changed = true;
  } else if (asked === "first_home" && firstHomeOf(next) === "unknown" && bareYesNo) {
    next.firstHome = bareNo ? "false" : "true";
    changed = true;
  }
  if (loansOf(next) === "unknown" && !idleQuestion(text) && mentions(text, /הלווא|loans?/) && !/נוספ|another|more loan|עוד הלוואה/i.test(text)) {
    next.loans = mentions(text, /אין הלווא|no loans|without loans/) ? "none" : "known";
    next.hasLoans = next.loans === "known";
    changed = true;
  } else if (asked === "loans" && loansOf(next) === "unknown" && (bareYesNo || missingTheDocument(text))) {
    next.loans = bareNo || missingTheDocument(text) ? "none" : "known";
    next.hasLoans = next.loans === "known";
    changed = true;
  }
  if (declinesExistingLoans(text) && loansOf(profile) === "unknown") {
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
  return { profile: next, changed, ...(revision ? { revision } : {}) };
}

type IncomingFact = { kind: string; fact?: string; value?: string };

function employmentConflictText(previous: Employment, next: Employment): string {
  const label = employmentLabelFor;
  return `הדיווח במערכת: ${label(previous)}. הלקוח עדכן: ${label(next)}.`;
}

/**
 * Apply fact intents from a customer-turn read. Retracts and how-to replies stay with the caller.
 * A status-report employment that changes is kept as the customer's value, and the disagreement
 * is stored beside the advisor flag so the income list still follows the new answer.
 */
export function applyFactIntents(
  input: Profile,
  intents: IncomingFact[],
  now: Date = new Date(),
): { profile: Profile; changed: boolean; revisions: FactRevision[]; loansCleared: boolean } {
  const profile = ensureBorrowers(input);
  const next: Profile = {
    ...profile,
    borrowers: borrowersOf(profile).map((borrower) => ({ ...borrower })),
    accounts: accountsOf(profile).map((account) => ({ ...account })),
  };
  const borrowers = borrowersOf(next);
  const revisions: FactRevision[] = [];
  let changed = false;
  let loansCleared = false;
  for (const intent of intents) {
    if (intent.kind !== "fact" || !intent.fact || !intent.value) continue;
    if (intent.fact === "loans" && (intent.value === "known" || intent.value === "none") && loansOf(next) !== intent.value) {
      const prior = loansOf(next);
      next.loans = intent.value;
      next.hasLoans = intent.value === "known";
      if (intent.value === "known" && next.loanMore === "no") next.loanMore = "";
      if (intent.value === "none") {
        next.loanMore = "no";
        if (prior === "known") loansCleared = true;
      }
      changed = true;
      if (prior !== "unknown" && intent.value === "known") revisions.push({ kind: "loans_known" });
      continue;
    }
    if (intent.fact === "employment" && EMPLOYMENT_VALUES.has(intent.value)) {
      const value = intent.value as Employment;
      const open = nextQuestion(profile);
      const target = open?.kind === "employment"
        ? borrowers.find((borrower) => borrower.slot === open.slot)
        : borrowers.find((borrower) => borrower.slot === "1") ?? borrowers[0];
      if (target && target.employment !== value) {
        const prior = target.employment;
        const fromReport = target.employmentSource === "status_report" && prior !== "unknown";
        assignEmployment(target, value, now);
        changed = true;
        if (fromReport) next.employmentConflict = employmentConflictText(prior, value);
        if (prior !== "unknown") revisions.push({ kind: "employment", detail: value });
      }
      continue;
    }
    if (intent.fact === "second_borrower" && (intent.value === "yes" || intent.value === "no")) {
      const prior = secondBorrowerOf({ ...next, borrowers });
      if (prior === intent.value) continue;
      if (intent.value === "no") {
        for (let index = borrowers.length - 1; index >= 0; index -= 1) {
          if (borrowers[index]?.slot === "2") borrowers.splice(index, 1);
        }
        next.secondBorrower = "no";
      } else {
        next.secondBorrower = "yes";
        if (!borrowers.some((borrower) => borrower.slot === "2")) borrowers.push(blankBorrower("2"));
      }
      changed = true;
      if (prior !== "unknown") revisions.push({ kind: intent.value === "yes" ? "second_yes" : "second_no" });
      continue;
    }
    if (intent.fact === "first_home" && (intent.value === "true" || intent.value === "false") && firstHomeOf(next) !== intent.value) {
      const prior = firstHomeOf(next);
      next.firstHome = intent.value;
      changed = true;
      if (prior !== "unknown") revisions.push({ kind: intent.value === "true" ? "first_home_yes" : "first_home_no" });
      continue;
    }
    if (intent.fact === "couple_split" && (intent.value === "yes" || intent.value === "no") && next.coupleSplit !== intent.value) {
      const prior = next.coupleSplit === "yes" || next.coupleSplit === "no" ? next.coupleSplit : "unknown";
      next.coupleSplit = intent.value;
      changed = true;
      if (prior !== "unknown") revisions.push({ kind: intent.value === "yes" ? "couple_yes" : "couple_no" });
      continue;
    }
    if (intent.fact === "split_who" && (intent.value === "1" || intent.value === "2")) {
      const prior = splitWhoOf({ ...next, borrowers });
      if (prior === intent.value) continue;
      const conflict = assignSplit(borrowers, intent.value, now);
      if (conflict) next.employmentConflict = conflict;
      changed = true;
      if (prior === "1" || prior === "2") revisions.push({ kind: "split_who", detail: intent.value });
      continue;
    }
    if (intent.fact === "salary_deposit" && (intent.value === "yes" || intent.value === "no")) {
      const target = borrowers.find((borrower) => borrower.salaryDeposit === "yes" || borrower.salaryDeposit === "no")
        ?? borrowers.find((borrower) => borrower.slot === "1");
      if (target && target.salaryDeposit !== intent.value) {
        const prior = target.salaryDeposit;
        target.salaryDeposit = intent.value;
        changed = true;
        if (prior === "yes" || prior === "no") {
          revisions.push({ kind: intent.value === "yes" ? "salary_yes" : "salary_no" });
        }
      }
      continue;
    }
    if (intent.fact === "more_loans" && intent.value === "yes" && next.loanMore === "no") {
      next.loanCount = loanCountOf(next) + 1;
      next.loanMore = "";
      next.loans = "known";
      next.hasLoans = true;
      changed = true;
      revisions.push({ kind: "more_loans" });
    } else if (intent.fact === "more_loans" && intent.value === "no" && next.loanMore !== "no") {
      next.loanMore = "no";
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
  return { profile: next, changed, revisions, loansCleared };
}

const EMPLOYMENT_VALUES = new Set<string>([
  "salaried",
  "self_employed",
  "controlling_shareholder",
  "both",
  "other",
]);
