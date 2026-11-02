import type { Check, Profile, RulesDocument } from "./rules";

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
  | { kind: "reject"; state: DossierState; slotId: string; reason: string; escalated: boolean };

const FAIL_LIMIT = 3;

export function freshDossier(opts: {
  smartClientId: string;
  profile: Profile;
  slots: { id: string; docType: string; stage: string; index: number }[];
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

export function activeStageOf(slots: SlotState[]): string {
  return slots.find((slot) => slot.status === "missing")?.stage ?? "";
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
  extracted: { docType: string; fields: Record<string, unknown> },
  now: Date = new Date(),
): FileJudgement {
  const open = state.slots.filter((slot) => slot.status === "missing");
  const fallback = open.find((slot) => slot.stage === state.activeStage) ?? open[0];
  if (!extracted.docType) {
    if (!fallback) return { kind: "reject", state, slotId: "", reason: "unreadable", escalated: false };
    return withFailure(state, fallback.id, "unreadable");
  }
  const slot = open.find((item) => item.docType === extracted.docType);
  if (!slot) {
    if (!fallback) return { kind: "reject", state, slotId: "", reason: "wrong_type", escalated: false };
    return withFailure(state, fallback.id, "wrong_type");
  }
  const checks = rules.documents[slot.docType]?.checks ?? [];
  const failure = runChecks(checks, extracted.fields, state.profile, now);
  if (failure) return withFailure(state, slot.id, failure.op);
  return { kind: "accept", slotId: slot.id, docType: slot.docType };
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
  const done = slots.every((slot) => slot.status === "uploaded");
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
  const labels: string[] = [];
  for (const slot of state.slots) {
    if (slot.status !== "missing" || slot.stage !== stage) continue;
    const label = rules.documents[slot.docType]?.labels[lang] ?? slot.docType;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}
