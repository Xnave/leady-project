import { flowForCatalog } from "./catalog";
import type { FlowDefinition, HitlPolicy, LeadSchema, Stage } from "./types";
import { FlowConfigError } from "./types";

export function stageTargets(stage: Stage): string[] {
  switch (stage.type) {
    case "classify":
      return Object.values(stage.transitions);
    case "collect":
      return [stage.on_complete];
    case "faq":
      return [stage.on_resolved, stage.on_unresolved];
    case "talk":
      return [stage.on_complete, stage.on_escalate].filter(Boolean);
    case "action":
      return [stage.on_complete, stage.on_fail].filter(Boolean);
    case "terminal":
      return [];
  }
}

export function validateFlow(
  flow: FlowDefinition,
  leadSchema: LeadSchema,
  hitl: HitlPolicy,
): void {
  const ids = new Set(Object.keys(flow.stages));
  const schemaKeys = new Set(Object.keys(leadSchema.fields));
  const errors: string[] = [];

  if (!ids.has(flow.start)) {
    errors.push(`start ${flow.start} is not a stage`);
  }

  if (
    flow.restartPolicy.onNewMessage === "fallback" &&
    !ids.has(flow.restartPolicy.fallbackStage ?? "")
  ) {
    errors.push("restartPolicy.fallbackStage missing");
  }

  const reachable = new Set<string>();
  const queue = [flow.start];
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || reachable.has(id) || !ids.has(id)) continue;
    reachable.add(id);
    for (const t of stageTargets(flow.stages[id])) queue.push(t);
  }

  for (const [id, stage] of Object.entries(flow.stages)) {
    const targets = stageTargets(stage);
    for (const t of targets) {
      if (!ids.has(t)) errors.push(`${id} transitions to unknown stage ${t}`);
    }
    if (stage.type !== "terminal" && targets.length === 0) {
      errors.push(`${id} is a dead end`);
    }
    if (!reachable.has(id) && id !== flow.start) {
      errors.push(`${id} is unreachable`);
    }
    if (stage.type === "collect") {
      for (const field of [
        ...stage.required_fields,
        ...(stage.optional_fields ?? []),
      ]) {
        if (!schemaKeys.has(field)) {
          errors.push(`${id} field ${field} not in leadSchema`);
        }
      }
    }
    if (stage.type === "talk") {
      for (const field of stage.required_for_book ?? []) {
        if (!schemaKeys.has(field)) {
          errors.push(`${id} required_for_book field ${field} not in leadSchema`);
        }
      }
    }
    if (stage.type === "action" && stage.action === "request_human") {
      if (!hitl.allowRequestHuman || !hitl.allowedFromStages.includes(id)) {
        errors.push(`${id} request_human not allowed by hitl_policy`);
      }
    }
  }

  if (errors.length) throw new FlowConfigError(errors);
}

export const defaultLeadSchema: LeadSchema = {
  fields: {
    intent: { type: "enum", enum: ["sales", "support", "other"] },
    name: { type: "string" },
    email: { type: "email" },
    phone: { type: "string" },
    service: { type: "string" },
    budget: { type: "string" },
    time_preference: { type: "string" },
    visit_kind: { type: "string" },
    need: { type: "string" },
    booking: { type: "string" },
  },
};

export const defaultHitlPolicy: HitlPolicy = {
  allowRequestHuman: true,
  allowedFromStages: ["talk", "escalate"],
  allowedIntents: ["sales", "support", "other"],
  minConfidence: 0.4,
};

export function defaultFlow(): FlowDefinition {
  return flowForCatalog("inbox");
}
