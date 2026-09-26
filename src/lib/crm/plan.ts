import { carrySnooze, deriveFollowUp } from "./followup";
import { collectSignals, type SignalSnapshot } from "./signals";
import { deriveLeadStage } from "./stage";
import type { FollowUpReason, PipelineStage, StageSource } from "./types";

export type LeadCrmColumns = {
  stage: PipelineStage;
  stageSource: StageSource;
  stageReason: string;
  stageChangedAt: Date;
  followUpReason: FollowUpReason | null;
  followUpAt: Date | null;
  snoozedUntil: Date | null;
  nextStepAt: Date | null;
  lastLeadMessageAt: Date | null;
  lastOutboundAt: Date | null;
};

export type LeadStateSnapshot = {
  current: LeadCrmColumns;
  signals: SignalSnapshot;
  openHandoffSince: Date | null;
  pendingApprovalSince: Date | null;
  lastLeadMessageAt: Date | null;
  lastOutboundAt: Date | null;
  lastRequestChangeAt: Date | null;
};

export type LeadStatePlan = {
  patch: Partial<LeadCrmColumns>;
  stageEvent: { from: PipelineStage; to: PipelineStage; source: StageSource; reason: string } | null;
};

const same = (a: Date | null, b: Date | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());

/** Pure: snapshot in, minimal column patch + optional stage event out. */
export function planLeadState(s: LeadStateSnapshot, now: Date): LeadStatePlan {
  const c = s.current;
  const decision = deriveLeadStage({
    current: { stage: c.stage, source: c.stageSource, reason: c.stageReason, changedAt: c.stageChangedAt },
    signals: collectSignals(s.signals),
    lastLeadMessageAt: s.lastLeadMessageAt,
    lastRequestChangeAt: s.lastRequestChangeAt,
  });
  const fu = deriveFollowUp({
    stage: decision.stage,
    openHandoffSince: s.openHandoffSince,
    pendingApprovalSince: s.pendingApprovalSince,
    nextStepAt: c.nextStepAt,
    lastLeadMessageAt: s.lastLeadMessageAt,
    lastOutboundAt: s.lastOutboundAt,
  });
  const snoozedUntil = carrySnooze(
    { reason: c.followUpReason, at: c.followUpAt, snoozedUntil: c.snoozedUntil },
    fu,
  );

  const patch: Partial<LeadCrmColumns> = {};
  let stageEvent: LeadStatePlan["stageEvent"] = null;
  if (decision.stage !== c.stage) {
    patch.stage = decision.stage;
    patch.stageChangedAt = now;
    stageEvent = { from: c.stage, to: decision.stage, source: decision.source, reason: decision.reason };
  }
  if (decision.source !== c.stageSource) patch.stageSource = decision.source;
  if (decision.reason !== c.stageReason) patch.stageReason = decision.reason;
  if ((fu?.reason ?? null) !== c.followUpReason) patch.followUpReason = fu?.reason ?? null;
  if (!same(fu?.at ?? null, c.followUpAt)) patch.followUpAt = fu?.at ?? null;
  if (!same(snoozedUntil, c.snoozedUntil)) patch.snoozedUntil = snoozedUntil;
  if (!same(s.lastLeadMessageAt, c.lastLeadMessageAt)) patch.lastLeadMessageAt = s.lastLeadMessageAt;
  if (!same(s.lastOutboundAt, c.lastOutboundAt)) patch.lastOutboundAt = s.lastOutboundAt;
  return { patch, stageEvent };
}
