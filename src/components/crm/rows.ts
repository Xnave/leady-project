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
