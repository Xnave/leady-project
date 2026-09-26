import {
  isClosedStage,
  stageRank,
  type PipelineStage,
  type StageSignal,
  type StageSource,
} from "./types";

const DEFAULT_SIGNAL: StageSignal = { stage: "new", reason: "first_message" };

/**
 * Highest-ranked open-pipeline signal wins (first one on ties). An automatic
 * `not_relevant` applies only while nothing above `talking` is signalled.
 * `lost` is never derived automatically.
 */
export function pickAutoStage(signals: StageSignal[]): StageSignal {
  let best = DEFAULT_SIGNAL;
  for (const s of signals) {
    if (isClosedStage(s.stage)) continue;
    if (stageRank(s.stage) > stageRank(best.stage)) best = s;
  }
  const notRelevant = signals.find((s) => s.stage === "not_relevant");
  if (notRelevant && stageRank(best.stage) <= stageRank("talking")) return notRelevant;
  return best;
}

export type StageInput = {
  current: { stage: PipelineStage; source: StageSource; reason: string; changedAt: Date };
  signals: StageSignal[];
  lastLeadMessageAt: Date | null;
  lastRequestChangeAt: Date | null;
};

export type StageDecision = { stage: PipelineStage; source: StageSource; reason: string };

function after(d: Date | null, ref: Date): boolean {
  return d !== null && d.getTime() > ref.getTime();
}

/**
 * Auto mode follows signals. A manual stage holds until a strong event:
 * a request changed after it was set; or, for a manual ranked (non-closed)
 * stage, an auto signal that ranks higher AND is at least `pending`, together
 * with a lead message newer than the manual choice — a `talking`/`qualified`
 * auto signal never overrides a manual stage, however highly ranked the
 * manual stage is. For lost / not_relevant, the lead
 * writing again also returns it to auto ("revived").
 */
export function deriveLeadStage(input: StageInput): StageDecision {
  const { current } = input;
  const auto = pickAutoStage(input.signals);
  const toAuto = (reason = auto.reason): StageDecision => ({
    stage: auto.stage,
    source: "auto",
    reason,
  });
  const keep: StageDecision = {
    stage: current.stage,
    source: current.source,
    reason: current.reason,
  };

  if (current.source === "auto") return toAuto();

  const requestMoved = after(input.lastRequestChangeAt, current.changedAt);
  if (isClosedStage(current.stage)) {
    if (requestMoved) return toAuto();
    if (after(input.lastLeadMessageAt, current.changedAt)) return toAuto("revived");
    return keep;
  }
  // Signals are not time-stamped (a request approved long ago still emits
  // `won`), so an outranking signal breaks the manual stage only with new
  // evidence after the owner's choice.
  const outranks =
    stageRank(auto.stage) > stageRank(current.stage) && stageRank(auto.stage) >= stageRank("pending");
  const newLeadMessage = after(input.lastLeadMessageAt, current.changedAt);
  if (requestMoved || (outranks && newLeadMessage)) return toAuto();
  return keep;
}
