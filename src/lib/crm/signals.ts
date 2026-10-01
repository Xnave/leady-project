import type { FlowDefinition } from "@/lib/flow/types";
import { isPipelineStage, type StageSignal } from "./types";

export type SignalSnapshot = {
  flow: FlowDefinition | null;
  /** flowState of the lead's latest conversation. */
  currentFlowStage: string | null;
  fields: Record<string, unknown>;
  hasAgentReply: boolean;
  /** Every request on the lead (the shared request primitive). */
  requests: { status: string; kind: string }[];
};

export type SignalProvider = (s: SignalSnapshot) => StageSignal[];

const providers = new Map<string, SignalProvider>();

/** Capabilities or future modules add signals here instead of editing derivation. */
export function registerPipelineSignalProvider(id: string, fn: SignalProvider): void {
  providers.set(id, fn);
}

function filled(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v !== undefined && v !== null && v !== false;
}

export function collectSignals(s: SignalSnapshot): StageSignal[] {
  const out: StageSignal[] = [{ stage: "new", reason: "first_message" }];
  const intent = typeof s.fields.intent === "string" ? s.fields.intent : "";

  if (s.hasAgentReply || intent) out.push({ stage: "talking", reason: "engaged" });

  const stages = s.flow?.stages ?? {};
  const current = s.currentFlowStage ? stages[s.currentFlowStage] : undefined;
  if (current?.pipeline && isPipelineStage(current.pipeline)) {
    out.push({ stage: current.pipeline, reason: `flow:${s.currentFlowStage}` });
  }

  for (const [id, stage] of Object.entries(stages)) {
    if (stage.type === "classify" && intent) {
      const target = stage.pipelineByIntent?.[intent];
      if (target && isPipelineStage(target)) out.push({ stage: target, reason: `intent:${intent}` });
    }
    if (
      stage.type === "collect" &&
      stage.required_fields.length > 0 &&
      stage.required_fields.every((f) => filled(s.fields[f]))
    ) {
      out.push({ stage: "qualified", reason: `collect:${id}` });
    }
  }
  if (filled(s.fields.name_collected_by_agent)) {
    out.push({ stage: "qualified", reason: "contact_collected" });
  }

  for (const r of s.requests) {
    if (r.status === "pending") out.push({ stage: "pending", reason: `request:${r.kind}:pending` });
    if (r.status === "approved") out.push({ stage: "won", reason: `request:${r.kind}:approved` });
  }

  for (const fn of providers.values()) out.push(...fn(s));
  return out;
}
