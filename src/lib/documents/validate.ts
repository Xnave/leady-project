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
      const same = leftDigits && rightDigits
        ? leftDigits === rightDigits
        : fold(value) !== "" && fold(value) === fold(expected);
      if (!same) return { op: check.op, field: check.field };
      continue;
    }
    if (check.op === "date_within_months") {
      const date = asDate(value);
      if (!date || !withinMonths(date, check.months, now)) return { op: check.op, field: check.field };
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
  | { kind: "accept"; slotId: string; docType: string }
  | { kind: "reject"; state: DossierState; slotId: string; reason: string; escalated: boolean }
  | { kind: "unplaced"; state: DossierState };

const FAIL_LIMIT = 3;

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
  return { ...profile, nationalId: borrower.nationalId, fullName: borrower.fullName, phone: borrower.phone };
}

function withFailure(state: DossierState, slotId: string, reason: string): FileJudgement {
  const slots = state.slots.map((slot) =>
    slot.id === slotId
      ? { ...slot, failCount: slot.failCount + 1, lastReason: reason }
      : slot,
  );
  const failed = slots.find((slot) => slot.id === slotId);
  const escalated = (failed?.failCount ?? 0) >= FAIL_LIMIT;
  return {
    kind: "reject",
    slotId,
    reason,
    escalated,
    state: {
      ...state,
      slots,
      status: escalated ? "blocked" : state.status,
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
): FileJudgement {
  const open = state.slots.filter((slot) => slot.status === "missing");
  const fallback = open.find((slot) => slot.stage === state.activeStage) ?? open[0];
  if (!extracted.docType) {
    const reason = extracted.unread ?? "wrong_type";
    if (!fallback) return { kind: "reject", state, slotId: "", reason, escalated: false };
    return withFailure(state, fallback.id, reason);
  }
  const sameType = open.filter((item) => item.docType === extracted.docType);
  const candidates = sameType.filter((item) => yearMatches(item, extracted.fields));
  if (!candidates.length && sameType.some((item) => item.year)) {
    return { kind: "unplaced", state };
  }
  if (!candidates.length) {
    if (!fallback) return { kind: "reject", state, slotId: "", reason: "wrong_type", escalated: false };
    return withFailure(state, fallback.id, "wrong_type");
  }
  let failed: { id: string; op: Check["op"] } | null = null;
  for (const candidate of candidates) {
    const checks = rules.documents[candidate.docType]?.checks ?? [];
    const failure = runChecks(checks, extracted.fields, profileForSlot(state.profile, candidate), now);
    if (!failure) return { kind: "accept", slotId: candidate.id, docType: candidate.docType };
    if (!failed) failed = { id: candidate.id, op: failure.op };
  }
  return withFailure(state, failed?.id ?? candidates[0].id, failed?.op ?? "wrong_type");
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
  const stage = stageId || state.activeStage;
  const seen = new Set<string>();
  const seenGroups = new Set<string>();
  const labels: string[] = [];
  const joiner = lang === "he" ? " או " : " or ";
  for (const slot of state.slots) {
    if (!isOutstanding(slot, state.slots) || slot.stage !== stage) continue;
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

function slotLabel(rules: RulesDocument, slot: SlotState, lang: "en" | "he"): string {
  const base = rules.documents[slot.docType]?.labels[lang] ?? slot.docType;
  return slot.year ? `${base} ${slot.year}` : base;
}
