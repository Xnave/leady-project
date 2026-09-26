/** Pure row logic for the leads list: what the optimistic updates change, and what a view shows. */
import type { CrmTab, LeadRowDTO } from "@/lib/crm/view";
import { isActiveStage, type PipelineStage } from "@/lib/crm/types";

export type ViewFilter = { tab: CrmTab; stage?: PipelineStage; channel?: string };

/** Only cold and reminder follow-ups can be snoozed (the API answers 409 otherwise). */
export function isSnoozable(r: LeadRowDTO): boolean {
  return r.due && (r.followUpReason === "cold" || r.followUpReason === "reminder");
}

/** Whether a row still belongs in the current view after a local change (mirrors `tabWhere`). */
export function matchesView(r: LeadRowDTO, v: ViewFilter): boolean {
  if (v.stage && r.stage !== v.stage) return false;
  if (v.channel && r.channel !== v.channel) return false;
  switch (v.tab) {
    case "needs":
      return r.due;
    case "active":
      return isActiveStage(r.stage);
    case "won":
      return r.stage === "won";
    case "closed":
      return r.stage === "lost" || r.stage === "not_relevant";
    case "all":
      return true;
  }
}

/**
 * A manual stage change. Mirrors `deriveFollowUp`: only a cold follow-up depends on the
 * stage being active; handoff, approval and reminders survive a close.
 */
export function withStage(r: LeadRowDTO, stage: PipelineStage): LeadRowDTO {
  const next: LeadRowDTO = { ...r, stage, stageSource: "manual" };
  if (r.followUpReason === "cold" && !isActiveStage(stage)) {
    return { ...next, followUpReason: null, followUpAt: null, due: false };
  }
  return next;
}

/** A next step at `at`. It becomes the reminder unless a handoff or approval outranks it. */
export function withNextStep(r: LeadRowDTO, text: string | null, at: string, now = new Date()): LeadRowDTO {
  const next: LeadRowDTO = { ...r, nextStepText: text, nextStepAt: at, stand: text ?? r.stand };
  if (r.followUpReason === "handoff" || r.followUpReason === "approval") return next;
  return { ...next, followUpReason: "reminder", followUpAt: at, snoozedUntil: null, due: new Date(at) <= now };
}

/** Snoozed locally until the server confirms: out of "needs you". */
export function withSnooze(r: LeadRowDTO, untilIso: string): LeadRowDTO {
  return { ...r, snoozedUntil: untilIso, due: false };
}

/** Put rows back where they were (by original index), replacing any copy still in the list. */
export function restoreRows(cur: LeadRowDTO[], saved: { row: LeadRowDTO; index: number }[]): LeadRowDTO[] {
  const ids = new Set(saved.map((s) => s.row.id));
  const out = cur.filter((r) => !ids.has(r.id));
  for (const s of [...saved].sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(s.index, out.length), 0, s.row);
  }
  return out;
}

/**
 * An optimistic edit still waiting on (or just confirmed by) the server. `patch` is what
 * changed; `row`/`index` let a row the server does not return yet be put back in place.
 */
export type PendingEdit = {
  token: number;
  patch: Partial<LeadRowDTO>;
  row: LeadRowDTO;
  index: number;
  /** The request succeeded; drop the edit once a refresh shows it (or after `MAX_MISSES`). */
  settled: boolean;
  misses: number;
};

/** Settled edits a refresh does not reflect are re-applied this many times, then trusted to the server. */
export const MAX_MISSES = 2;
/**
 * Fields the server derives differently (timezone, summary, undo's manual source); not used
 * to confirm an edit. `nextStepAt` is stable: the server stores the client's ISO as sent.
 */
const UNSTABLE: (keyof LeadRowDTO)[] = ["snoozedUntil", "followUpAt", "stand", "stageSource"];

export function diffRow(before: LeadRowDTO, after: LeadRowDTO): Partial<LeadRowDTO> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof LeadRowDTO)[]) {
    if (after[k] !== before[k]) out[k] = after[k];
  }
  return out as Partial<LeadRowDTO>;
}

/** A refresh shows the edit when every stable patched field matches. No stable field means no proof. */
function reflects(server: LeadRowDTO, patch: Partial<LeadRowDTO>): boolean {
  const keys = (Object.keys(patch) as (keyof LeadRowDTO)[]).filter((k) => !UNSTABLE.includes(k));
  return keys.length > 0 && keys.every((k) => server[k] === patch[k]);
}

/**
 * Server rows with in-flight edits laid over them, so a refresh started before an edit
 * committed cannot revert it. Returns which settled edits to drop (confirmed or given up)
 * and which were missed (the refresh did not show them yet).
 */
export function mergePending(
  server: LeadRowDTO[],
  pending: ReadonlyMap<string, PendingEdit>,
  view: ViewFilter,
): { rows: LeadRowDTO[]; drop: string[]; missed: string[] } {
  const drop: string[] = [];
  const missed: string[] = [];
  const keep = (id: string, p: PendingEdit, confirmed: boolean) => {
    if (!p.settled) return true;
    if (confirmed || p.misses + 1 >= MAX_MISSES) {
      drop.push(id);
      return false;
    }
    missed.push(id);
    return true;
  };
  const seen = new Set<string>();
  const rows = server.map((r) => {
    seen.add(r.id);
    const p = pending.get(r.id);
    return p && keep(r.id, p, reflects(r, p.patch)) ? { ...r, ...p.patch } : r;
  });
  // Rows the server left out (e.g. an undo that has not landed yet) go back where they were.
  for (const [id, p] of [...pending].sort((a, b) => a[1].index - b[1].index)) {
    if (seen.has(id) || !keep(id, p, false)) continue;
    rows.splice(Math.min(p.index, rows.length), 0, p.row);
  }
  return { rows: rows.filter((r) => matchesView(r, view)), drop, missed };
}

/**
 * One report from the peek panel about one of its actions. `action` identifies the action
 * (0 = no action, e.g. a reload after a chat send). A `failed` report carries `undo`: only
 * the fields this action changed, with their values from before it.
 */
export type PeekReport = {
  row: Partial<LeadRowDTO> & { id: string };
  phase: "optimistic" | "confirmed" | "failed";
  action: number;
  undo?: Partial<LeadRowDTO>;
};

/**
 * What the list does with a peek report. `held` is the action that owns the lead's pending
 * edit: undefined when there is none, or a value no action has (e.g. -1) when the list's own
 * action owns it. Only the owning action may settle or roll back; a report from an older,
 * superseded action leaves the row to the newer action's own reports.
 * - `track`: apply and hold unsettled. `settle`: apply and settle. `apply`: apply server truth.
 * - `rollback`: drop the pending edit and restore `undo`. `refresh`: only refresh. `ignore`: nothing.
 */
export type AbsorbStep = "track" | "settle" | "apply" | "rollback" | "refresh" | "ignore";

export function absorbStep(phase: PeekReport["phase"], action: number, held: number | undefined): AbsorbStep {
  if (phase === "optimistic") return "track";
  if (phase === "confirmed") return held === undefined ? "apply" : held === action ? "settle" : "refresh";
  return held === undefined ? "refresh" : held === action ? "rollback" : "ignore";
}

/** The fields `after` changed, with their `before` values (a per-action rollback). */
export function undoPatch(before: LeadRowDTO, after: LeadRowDTO): Partial<LeadRowDTO> {
  return diffRow(after, before);
}
