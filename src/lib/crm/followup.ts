import { COLD_AFTER_HOURS, isActiveStage, type FollowUpReason, type PipelineStage } from "./types";

const HOUR = 60 * 60 * 1000;

export type FollowUpInput = {
  stage: PipelineStage;
  openHandoffSince: Date | null;
  pendingApprovalSince: Date | null;
  nextStepAt: Date | null;
  lastLeadMessageAt: Date | null;
  /** Last agent or staff message. */
  lastOutboundAt: Date | null;
};

export type FollowUp = { reason: FollowUpReason; at: Date } | null;

/**
 * The single highest-priority reason and when it is (or becomes) due.
 * Future `at` values are stored ahead of time, so leads surface in the
 * "Needs you" query as time passes — no cron.
 */
export function deriveFollowUp(i: FollowUpInput): FollowUp {
  if (i.openHandoffSince) return { reason: "handoff", at: i.openHandoffSince };
  if (i.pendingApprovalSince) return { reason: "approval", at: i.pendingApprovalSince };
  if (i.nextStepAt) return { reason: "reminder", at: i.nextStepAt };
  if (!isActiveStage(i.stage) || !i.lastOutboundAt) return null;
  if (i.lastLeadMessageAt && i.lastLeadMessageAt.getTime() >= i.lastOutboundAt.getTime()) {
    return null;
  }
  return { reason: "cold", at: new Date(i.lastOutboundAt.getTime() + COLD_AFTER_HOURS * HOUR) };
}

/** A snooze belongs to one episode: same reason and same due time. */
export function carrySnooze(
  prev: { reason: string | null; at: Date | null; snoozedUntil: Date | null },
  next: FollowUp,
): Date | null {
  if (!prev.snoozedUntil || !next || !prev.at) return null;
  if (prev.reason !== next.reason) return null;
  if (prev.at.getTime() !== next.at.getTime()) return null;
  return prev.snoozedUntil;
}

export function isFollowUpDue(
  fu: { reason: string | null; at: Date | null; snoozedUntil: Date | null },
  now: Date,
): boolean {
  if (!fu.reason || !fu.at) return false;
  if (fu.at.getTime() > now.getTime()) return false;
  if (fu.snoozedUntil && fu.snoozedUntil.getTime() > now.getTime()) return false;
  return true;
}

/** WhatsApp customer-service window: 24h after the lead's last message. */
export function waWindow(
  lastLeadMessageAt: Date | null,
  now: Date,
): { closesAt: Date | null; hoursLeft: number | null; closed: boolean } {
  if (!lastLeadMessageAt) return { closesAt: null, hoursLeft: null, closed: true };
  const closesAt = new Date(lastLeadMessageAt.getTime() + 24 * HOUR);
  const left = closesAt.getTime() - now.getTime();
  if (left <= 0) return { closesAt, hoursLeft: 0, closed: true };
  return { closesAt, hoursLeft: Math.floor(left / HOUR), closed: false };
}
