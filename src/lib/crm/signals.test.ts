import { describe, expect, it } from "vitest";
import type { FlowDefinition } from "@/lib/flow/types";
import { collectSignals, registerPipelineSignalProvider } from "./signals";

const flow: FlowDefinition = {
  start: "triage",
  restartPolicy: { onNewMessage: "ignore" },
  stages: {
    triage: {
      type: "classify",
      prompt: "",
      intents: ["sales", "job"],
      transitions: { sales: "talk", job: "done" },
      pipelineByIntent: { job: "not_relevant" },
    },
    info: { type: "collect", prompt: "", required_fields: ["name", "phone"], on_complete: "talk" },
    talk: { type: "talk", prompt: "", on_complete: "done", on_escalate: "done", pipeline: "talking" },
    quoted: { type: "action", action: "x", on_complete: "done", on_fail: "done", pipeline: "pending" },
    done: { type: "terminal" },
  },
};
const snap = (over: Partial<Parameters<typeof collectSignals>[0]> = {}) => ({
  flow,
  currentFlowStage: null,
  fields: {},
  hasAgentReply: false,
  requests: [],
  ...over,
});
const stages = (s: ReturnType<typeof collectSignals>) => s.map((x) => x.stage);

describe("collectSignals", () => {
  it("always includes new", () => {
    expect(stages(collectSignals(snap()))).toEqual(["new"]);
  });
  it("adds talking after a bot reply or a known intent", () => {
    expect(stages(collectSignals(snap({ hasAgentReply: true })))).toContain("talking");
    expect(stages(collectSignals(snap({ fields: { intent: "sales" } })))).toContain("talking");
  });
  it("reads the current flow stage annotation", () => {
    expect(collectSignals(snap({ currentFlowStage: "quoted" }))).toContainEqual({
      stage: "pending",
      reason: "flow:quoted",
    });
  });
  it("maps intents through pipelineByIntent", () => {
    expect(collectSignals(snap({ fields: { intent: "job" } }))).toContainEqual({
      stage: "not_relevant",
      reason: "intent:job",
    });
  });
  it("marks qualified when a collect stage's required fields are filled", () => {
    expect(collectSignals(snap({ fields: { name: "Dana", phone: "050" } }))).toContainEqual({
      stage: "qualified",
      reason: "collect:info",
    });
    expect(stages(collectSignals(snap({ fields: { name: "Dana" } })))).not.toContain("qualified");
  });
  it("marks qualified when the agent collected the contact", () => {
    expect(stages(collectSignals(snap({ fields: { name_collected_by_agent: "1" } })))).toContain(
      "qualified",
    );
  });
  it("turns requests into pending and won", () => {
    const s = collectSignals(
      snap({ requests: [{ status: "pending", kind: "a" }, { status: "approved", kind: "b" }] }),
    );
    expect(s).toContainEqual({ stage: "pending", reason: "request:a:pending" });
    expect(s).toContainEqual({ stage: "won", reason: "request:b:approved" });
  });
  it("ignores rejected requests", () => {
    expect(stages(collectSignals(snap({ requests: [{ status: "rejected", kind: "a" }] })))).toEqual(["new"]);
  });
  it("includes registered providers", () => {
    registerPipelineSignalProvider("test-provider", (s) =>
      s.fields.vip ? [{ stage: "qualified", reason: "vip" }] : [],
    );
    expect(collectSignals(snap({ fields: { vip: true } }))).toContainEqual({ stage: "qualified", reason: "vip" });
  });
});
