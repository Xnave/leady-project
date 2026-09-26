/**
 * CRM pipeline vocabulary. Pure: no Prisma, no business domain names.
 * Stage ids are fixed for every tenant; labels vary per vertical in UI copy.
 */
export const PIPELINE_STAGES = [
  "new",
  "talking",
  "qualified",
  "pending",
  "won",
  "lost",
  "not_relevant",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Open pipeline in rank order. Closed stages sit outside the ranking. */
export const RANKED_STAGES = ["new", "talking", "qualified", "pending", "won"] as const;
export const ACTIVE_STAGES = ["new", "talking", "qualified", "pending"] as const;
export const CLOSED_STAGES = ["lost", "not_relevant"] as const;

export type StageSource = "auto" | "manual";

/** A source's claim about where a lead is. `reason` is shown as "Auto · why". */
export type StageSignal = { stage: PipelineStage; reason: string };

export type FollowUpReason = "handoff" | "approval" | "reminder" | "cold";
export const FOLLOW_UP_PRIORITY: readonly FollowUpReason[] = [
  "handoff",
  "approval",
  "reminder",
  "cold",
];

/** Our last message + this many hours without a reply = cold (leaves ~4h of the WhatsApp window). */
export const COLD_AFTER_HOURS = 20;

export function isPipelineStage(v: unknown): v is PipelineStage {
  return typeof v === "string" && (PIPELINE_STAGES as readonly string[]).includes(v);
}

export function isActiveStage(v: string): boolean {
  return (ACTIVE_STAGES as readonly string[]).includes(v);
}

export function isClosedStage(v: string): boolean {
  return (CLOSED_STAGES as readonly string[]).includes(v);
}

/** Index in the open pipeline; -1 for closed stages. */
export function stageRank(stage: PipelineStage): number {
  return (RANKED_STAGES as readonly string[]).indexOf(stage);
}

export function isFollowUpReason(v: unknown): v is FollowUpReason {
  return typeof v === "string" && (FOLLOW_UP_PRIORITY as readonly string[]).includes(v);
}
