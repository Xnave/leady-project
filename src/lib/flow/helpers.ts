import { nudgeSpecForStage } from "./catalog";
import type {
  FlowDefinition,
  HitlPolicy,
  LeadFields,
  MessageSnapshot,
  NudgeSpec,
  Stage,
  TurnContext,
} from "./types";

export function resolvedNudgeSpec(stage: Stage): NudgeSpec | undefined {
  return nudgeSpecForStage(stage);
}

export function missingRequired(fields: LeadFields, required: string[]): string[] {
  return required.filter((key) => {
    const value = fields[key];
    return value == null || value === "";
  });
}

export function applyRestartPolicy(
  flow: FlowDefinition,
): { kind: "ignore" } | { kind: "goto"; stageId: string } {
  const policy = flow.restartPolicy;
  if (policy.onNewMessage === "ignore") return { kind: "ignore" };
  if (policy.onNewMessage === "restart") {
    return { kind: "goto", stageId: flow.start };
  }
  return { kind: "goto", stageId: policy.fallbackStage ?? flow.start };
}

export function assertHitlAllowed(ctx: TurnContext, stageId: string): void {
  const policy: HitlPolicy | undefined = ctx.agent.hitlPolicy;
  if (!policy?.allowRequestHuman) {
    throw new Error("hitl_disabled");
  }
  if (!policy.allowedFromStages.includes(stageId)) {
    throw new Error("hitl_stage_not_allowed");
  }
  const intent = ctx.lead.fields.intent;
  if (policy.allowedIntents?.length && intent) {
    if (!policy.allowedIntents.includes(String(intent))) {
      throw new Error("hitl_intent_not_allowed");
    }
  }
}

export function mergeAllowedFields(
  schemaKeys: string[],
  current: LeadFields,
  incoming: LeadFields,
): LeadFields {
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!schemaKeys.includes(key)) continue;
    if (value == null) continue;
    if (value === "") {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function addIsoDuration(from: Date, isoDuration: string): Date {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(isoDuration);
  if (!match) {
    throw new Error(`unsupported duration ${isoDuration}`);
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return new Date(
    from.getTime() + ((hours * 3600 + minutes * 60 + seconds) * 1000),
  );
}

/** ISO-8601 duration for nudge delay; `NUDGE_AFTER_OVERRIDE` wins in dev (e.g. PT5M). */
export function resolveNudgeAfterDuration(flowAfter: string): string {
  const override = (process.env.NUDGE_AFTER_OVERRIDE ?? "").trim();
  return override || flowAfter;
}

/** Nudges only while the conversation is actively waiting on the lead in a non-terminal stage. */
export function shouldScheduleNudge(ctx: TurnContext, stageId: string, stage: Stage): boolean {
  if (!resolvedNudgeSpec(stage)) return false;
  if (stage.type === "terminal") return false;
  if (ctx.conversation.status !== "open") return false;
  const atId = ctx.agent.flow.stages[stageId];
  if (atId?.type === "terminal") return false;
  return true;
}

/** `lastLead + after`, or null when that instant is already due (don't fire on this turn). */
export function resolveNudgeFireAt(
  anchorAt: Date,
  after: string,
  now = new Date(),
): Date | null {
  const at = addIsoDuration(anchorAt, after);
  if (at.getTime() <= now.getTime()) return null;
  return at;
}

/** True when the lead wrote after the timestamp this reminder was anchored on. */
export function leadRepliedSinceAnchor(
  messages: MessageSnapshot[],
  anchorLeadMessageAt: string,
): boolean {
  const anchor = Date.parse(anchorLeadMessageAt);
  if (Number.isNaN(anchor)) return false;
  return lastLeadMessageAt(messages, new Date(0)).getTime() > anchor;
}

export function lastLeadMessageAt(messages: MessageSnapshot[], fallback = new Date()): Date {
  let latest: Date | null = null;
  for (const m of messages) {
    if (m.role !== "lead") continue;
    const at =
      m.createdAt instanceof Date
        ? m.createdAt
        : typeof m.createdAt === "string"
          ? new Date(m.createdAt)
          : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    if (!latest || at > latest) latest = at;
  }
  return latest ?? fallback;
}
