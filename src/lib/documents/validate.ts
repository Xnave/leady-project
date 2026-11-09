import { borrowersOf } from "./facts";
import type { Check, Profile, RulesDocument, Slot } from "./rules";

export type CheckFailure = { op: Check["op"]; field?: string };

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function fold(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function asDate(value: unknown): Date | null {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function itemCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed.length;
    } catch {
      /* fall through */
    }
  }
  return text.split(/[,;\n]/).filter((part) => part.trim()).length;
}

function withinMonths(date: Date, months: number, now: Date): boolean {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return date.getTime() >= cutoff.getTime() && date.getTime() <= now.getTime();
}

/** Payslip months that fall inside the rolling window the rules accept. */
export function recentPayslipMonths(value: unknown, months = 3, now = new Date()): string[] {
  return monthsIn(value).filter((month) => {
    const [year, mon] = month.split("-").map(Number);
    if (!year || !mon) return false;
    return withinMonths(new Date(Date.UTC(year, mon - 1, 15)), months, now);
  });
}

/**
 * One accepted payslip file can close the other open payslip slots when it
 * contains more than one month inside the window. The first month is the slot
 * the file itself was placed on.
 */
export function extraPayslipSlotIds(
  state: DossierState,
  frontSlotId: string,
  months: string[],
  now = new Date(),
): string[] {
  const front = state.slots.find((slot) => slot.id === frontSlotId);
  if (!front || front.docType !== "payslip") return [];
  const room = Math.max(0, recentPayslipMonths(months.join(","), 3, now).length - 1);
  if (!room) return [];
  return state.slots
    .filter((slot) =>
      slot.docType === "payslip" &&
      slot.borrower === front.borrower &&
      slot.id !== front.id &&
      slot.status !== "uploaded",
    )
    .slice(0, room)
    .map((slot) => slot.id);
}

export function runChecks(
  checks: Check[],
  extracted: Record<string, unknown>,
  profile: Profile,
  now: Date = new Date(),
): CheckFailure | null {
  for (const check of checks) {
    const value = extracted[check.field];
    if (check.op === "field_present") {
      if (value === undefined || value === null || String(value).trim() === "") {
        return { op: check.op, field: check.field };
      }
      continue;
    }
    if (check.op === "matches_profile") {
      const expected = profile[check.profileKey];
      const leftDigits = digits(value);
      const rightDigits = digits(expected);
      const expectedText = fold(expected);
      if (!rightDigits && !expectedText) {
        if (leftDigits || fold(value)) continue;
        return { op: check.op, field: check.field };
      }
      const same = leftDigits && rightDigits
        ? leftDigits === rightDigits
        : fold(value) !== "" && fold(value) === expectedText;
      if (!same) return { op: check.op, field: check.field };
      continue;
    }
    if (check.op === "date_within_months") {
      const date = asDate(value);
      if (!date || !withinMonths(date, check.months, now)) return { op: check.op, field: check.field };
      continue;
    }
    if (check.op === "prior_calendar_months") {
      const allowed = new Set(priorCalendarMonths(now, check.months));
      const found = monthsIn(value);
      if (!found.length || found.some((month) => !allowed.has(month))) {
        return { op: check.op, field: check.field };
      }
      continue;
    }
    if (itemCount(value) < check.count) return { op: check.op, field: check.field };
  }
  return null;
}

export type SlotState = {
  id: string;
  docType: string;
  stage: string;
  index: number;
  borrower?: string;
  accountId?: string;
  year?: number;
  altGroup?: string;
  collectionStage?: string;
  months?: string[];
  coveredMonths?: string[];
  status: "missing" | "uploaded";
  failCount: number;
  lastReason: string;
  remoteId: string;
  filename: string;
};

export type DossierState = {
  status: "needs_id" | "gathering" | "complete" | "blocked";
  smartClientId: string;
  profile: Profile;
  slots: SlotState[];
  activeStage: string;
};

export type FileJudgement =
  | { kind: "accept"; slotId: string; docType: string; coveredMonths?: string[] }
  | { kind: "reject"; state: DossierState; slotId: string; reason: string; field?: string; atLimit: boolean }
  | { kind: "unplaced"; state: DossierState };

/** Default try limit when the tenant has not configured documents.maxRejectTries. */
export const DEFAULT_REJECT_TRIES = 5;

export function freshDossier(opts: {
  smartClientId: string;
  profile: Profile;
  slots: Slot[];
}): DossierState {
  const slots: SlotState[] = opts.slots.map((slot) => ({
    ...slot,
    status: "missing",
    failCount: 0,
    lastReason: "",
    remoteId: "",
    filename: "",
  }));
  return {
    status: slots.length ? "gathering" : "complete",
    smartClientId: opts.smartClientId,
    profile: opts.profile,
    slots,
    activeStage: slots[0]?.stage ?? "",
  };
}

/** An alt-group slot is outstanding only while none of its siblings is uploaded. */
export function isOutstanding(slot: SlotState, slots: SlotState[]): boolean {
  if (slot.status !== "missing") return false;
  if (!slot.altGroup) return true;
  return !slots.some((other) => other.altGroup === slot.altGroup && other.status === "uploaded");
}

export function dossierDone(slots: SlotState[]): boolean {
  return slots.length > 0 && slots.every((slot) => !isOutstanding(slot, slots));
}

export function activeStageOf(slots: SlotState[]): string {
  return slots.find((slot) => isOutstanding(slot, slots))?.stage ?? "";
}

function yearOf(fields: Record<string, unknown>): number | null {
  const raw = fields.year ?? fields.taxYear ?? fields.periodEnd ?? "";
  const match = String(raw).match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

/** A slot that names a year accepts a file only when that year is written on it. */
function yearMatches(slot: SlotState, fields: Record<string, unknown>): boolean {
  if (!slot.year) return true;
  return yearOf(fields) === slot.year;
}

function profileForSlot(profile: Profile, slot: { borrower?: string }): Profile {
  if (!slot.borrower) return profile;
  const borrower = borrowersOf(profile).find((item) => item.slot === slot.borrower);
  if (!borrower) return profile;
  return {
    ...profile,
    nationalId: borrower.nationalId || profile.nationalId,
    fullName: borrower.fullName || profile.fullName,
    phone: borrower.phone || profile.phone,
  };
}

function withFailure(
  state: DossierState,
  slotId: string,
  reason: string,
  maxTries: number,
  field?: string,
): FileJudgement {
  const slots = state.slots.map((slot) =>
    slot.id === slotId
      ? { ...slot, failCount: slot.failCount + 1, lastReason: reason }
      : slot,
  );
  const failed = slots.find((slot) => slot.id === slotId);
  const atLimit = (failed?.failCount ?? 0) >= maxTries;
  return {
    kind: "reject",
    slotId,
    reason,
    ...(field ? { field } : {}),
    atLimit,
    state: {
      ...state,
      slots,
      // Stay gathering: the customer may wait out a cool-off or ask for a person.
      status: state.status === "blocked" ? "gathering" : state.status,
      activeStage: activeStageOf(slots),
    },
  };
}

/**
 * Decide whether an extracted file fills an open slot.
 * Acceptance does not mark the slot uploaded — that happens after SmartNPV accepts the bytes.
 */
export function judgeFile(
  state: DossierState,
  rules: RulesDocument,
  extracted: { docType: string; fields: Record<string, unknown>; unread?: "no_model" | "extract_failed" },
  now: Date = new Date(),
  opts?: { maxTries?: number },
): FileJudgement {
  const maxTries = Math.max(1, opts?.maxTries ?? DEFAULT_REJECT_TRIES);
  const open = state.slots.filter((slot) => slot.status === "missing");
  const fallback = open.find((slot) => slot.stage === state.activeStage) ?? open[0];
  if (!extracted.docType) {
    const reason = extracted.unread ?? "unrecognized";
    if (!fallback) return { kind: "reject", state, slotId: "", reason, atLimit: false };
    return withFailure(state, fallback.id, reason, maxTries);
  }
  const sameType = open.filter((item) => item.docType === extracted.docType);
  const candidates = sameType.filter((item) => yearMatches(item, extracted.fields));
  if (!candidates.length && sameType.some((item) => item.year)) {
    return { kind: "unplaced", state };
  }
  if (!candidates.length && extracted.docType === "id_card") {
    const back = open.filter((item) => item.docType === "id_card_back");
    if (back.length) candidates.push(...back);
  }
  if (!candidates.length) {
    if (!fallback) return { kind: "reject", state, slotId: "", reason: "wrong_type", atLimit: false };
    return withFailure(state, fallback.id, "wrong_type", maxTries);
  }
  let failed: { id: string; op: Check["op"]; field?: string } | null = null;
  for (const candidate of candidates) {
    const checks = rules.documents[candidate.docType]?.checks ?? [];
    const failure = runChecks(checks, extracted.fields, profileForSlot(state.profile, candidate), now);
    if (!failure) {
      const coveredMonths = monthsIn(extracted.fields.months ?? extracted.fields.periodEnd);
      return {
        kind: "accept",
        slotId: candidate.id,
        docType: candidate.docType,
        ...(coveredMonths.length ? { coveredMonths } : {}),
      };
    }
    if (!failed) failed = { id: candidate.id, op: failure.op, field: failure.field };
  }
  return withFailure(state, failed?.id ?? candidates[0].id, failed?.op ?? "wrong_type", maxTries, failed?.field);
}

/** The three calendar months before this month, oldest first, in Asia/Jerusalem. */
export function priorCalendarMonths(now = new Date(), count = 3): string[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const out: string[] = [];
  for (let back = count; back >= 1; back -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    out.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** YYYY-MM values named in a statement field. One file may name several months. */
export function monthsIn(value: unknown): string[] {
  return [...new Set(String(value ?? "").match(/\d{4}-\d{2}/g) ?? [])];
}

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];
const ENGLISH_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function calendarYear(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "year")?.value);
}

/** April, or April 2025 when the month is not in the current calendar year. */
export function formatStatementMonth(yyyyMm: string, lang: "en" | "he", now = new Date()): string {
  const match = yyyyMm.match(/^(\d{4})-(\d{2})$/);
  if (!match) return yyyyMm;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const name = (lang === "he" ? HEBREW_MONTHS : ENGLISH_MONTHS)[month - 1];
  if (!name) return yyyyMm;
  return year === calendarYear(now) ? name : `${name} ${year}`;
}

/** Remember which months a payslip slot already accepted, without reopening it. */
export function noteSlotMonths(state: DossierState, slotId: string, months: string[]): DossierState {
  const covered = [...new Set(months.filter(Boolean))].sort();
  if (!covered.length) return state;
  return {
    ...state,
    slots: state.slots.map((slot) => (slot.id === slotId ? { ...slot, coveredMonths: covered } : slot)),
  };
}

/** Add the months a statement covered. The slot stays open until every required month is in. */
export function recordMonths(
  state: DossierState,
  slotId: string,
  covered: string[],
  remoteId: string,
  filename: string,
): DossierState {
  const slots = state.slots.map((slot) => {
    if (slot.id !== slotId) return slot;
    const next = [...new Set([...(slot.coveredMonths ?? []), ...covered])];
    const required = slot.months ?? [];
    const done = required.length > 0 && required.every((month) => next.includes(month));
    return {
      ...slot,
      coveredMonths: next,
      status: done ? ("uploaded" as const) : ("missing" as const),
      remoteId,
      filename,
      lastReason: "",
    };
  });
  const done = dossierDone(slots);
  return {
    ...state,
    slots,
    status: done ? "complete" : "gathering",
    activeStage: activeStageOf(slots),
  };
}

export function commitSlot(
  state: DossierState,
  slotId: string,
  remoteId: string,
  filename: string,
): DossierState {
  const slots = state.slots.map((slot) =>
    slot.id === slotId
      ? { ...slot, status: "uploaded" as const, remoteId, filename, lastReason: "" }
      : slot,
  );
  const done = dossierDone(slots);
  return {
    ...state,
    slots,
    status: done ? "complete" : "gathering",
    activeStage: activeStageOf(slots),
  };
}

export function missingLabels(
  state: DossierState,
  rules: RulesDocument,
  lang: "en" | "he",
  stageId?: string,
): string[] {
  const stage = stageId === "*" ? "" : stageId || state.activeStage;
  const seen = new Set<string>();
  const seenGroups = new Set<string>();
  const labels: string[] = [];
  const joiner = lang === "he" ? " או " : " or ";
  for (const slot of state.slots) {
    if (!isOutstanding(slot, state.slots) || (stage && slot.stage !== stage)) continue;
    if (slot.altGroup) {
      if (seenGroups.has(slot.altGroup)) continue;
      seenGroups.add(slot.altGroup);
      const alternatives = state.slots
        .filter((other) => other.altGroup === slot.altGroup && isOutstanding(other, state.slots))
        .map((other) => slotLabel(rules, other, lang));
      const label = alternatives.join(joiner);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
      continue;
    }
    const label = slotLabel(rules, slot, lang);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function slotDisplayLabel(rules: RulesDocument, slot: SlotState, lang: "en" | "he"): string {
  const base = rules.documents[slot.docType]?.labels[lang] ?? slot.docType;
  if (slot.year) return `${base} ${slot.year}`;
  if (slot.months?.length) {
    const covered = new Set(slot.coveredMonths ?? []);
    const missing = slot.months.filter((month) => !covered.has(month));
    if (missing.length) {
      return lang === "he"
        ? `${base} עבור ${missing.length} חודשים אחרונים`
        : `${base} for the last ${missing.length} months`;
    }
  }
  return base;
}

function slotLabel(rules: RulesDocument, slot: SlotState, lang: "en" | "he"): string {
  return slotDisplayLabel(rules, slot, lang);
}
