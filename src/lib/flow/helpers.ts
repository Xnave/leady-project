import type { FlowDefinition, HitlPolicy, LeadFields, TurnContext } from "./types";

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
    if (value == null || value === "") continue;
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
