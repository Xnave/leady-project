import { describe, expect, it } from "vitest";
import { defaultFlow, defaultHitlPolicy, defaultLeadSchema, validateFlow } from "./validate";
import { FlowConfigError } from "./types";
import { salesOrSupportFlow } from "./templates";
import { flowForCatalog } from "./catalog";

describe("validateFlow", () => {
  it("accepts the inbox talk catalog", () => {
    expect(() =>
      validateFlow(defaultFlow(), defaultLeadSchema, defaultHitlPolicy),
    ).not.toThrow();
  });

  it("accepts the legacy sales/support flow", () => {
    expect(() =>
      validateFlow(salesOrSupportFlow, defaultLeadSchema, {
        ...defaultHitlPolicy,
        allowedFromStages: ["escalate"],
      }),
    ).not.toThrow();
  });

  it("rejects unknown transitions", () => {
    const flow = structuredClone(salesOrSupportFlow);
    const collect = flow.stages.collect_lead;
    if (collect.type !== "collect") throw new Error("expected collect");
    collect.on_complete = "nope";
    expect(() =>
      validateFlow(flow, defaultLeadSchema, {
        ...defaultHitlPolicy,
        allowedFromStages: ["escalate"],
      }),
    ).toThrow(FlowConfigError);
  });

  it("rejects collect fields missing from schema", () => {
    const flow = structuredClone(salesOrSupportFlow);
    if (flow.stages.collect_lead.type !== "collect") throw new Error("expected collect");
    flow.stages.collect_lead.required_fields = ["spaceship"];
    expect(() =>
      validateFlow(flow, defaultLeadSchema, {
        ...defaultHitlPolicy,
        allowedFromStages: ["escalate"],
      }),
    ).toThrow(/spaceship/);
  });

  it("rejects request_human outside hitl policy", () => {
    const hitl = { ...defaultHitlPolicy, allowedFromStages: [] };
    expect(() => validateFlow(salesOrSupportFlow, defaultLeadSchema, hitl)).toThrow(
      /request_human/,
    );
  });
});

describe("pipeline annotations", () => {
  it("accepts valid pipeline ids on stages", () => {
    const flow = structuredClone(flowForCatalog("inbox"));
    const talkId = Object.keys(flow.stages).find((id) => flow.stages[id].type === "talk")!;
    flow.stages[talkId] = { ...flow.stages[talkId], pipeline: "talking" };
    expect(() => validateFlow(flow, defaultLeadSchema, defaultHitlPolicy)).not.toThrow();
  });

  it("rejects unknown pipeline ids", () => {
    const flow = structuredClone(flowForCatalog("inbox"));
    const talkId = Object.keys(flow.stages).find((id) => flow.stages[id].type === "talk")!;
    flow.stages[talkId] = { ...flow.stages[talkId], pipeline: "closed_won" };
    expect(() => validateFlow(flow, defaultLeadSchema, defaultHitlPolicy)).toThrow(/pipeline/);
  });

  it("rejects unknown ids in pipelineByIntent", () => {
    const flow = structuredClone(flowForCatalog("inbox"));
    flow.stages.triage = {
      type: "classify",
      prompt: "x",
      intents: ["sales", "spam"],
      transitions: { sales: flow.start, spam: flow.start },
      pipelineByIntent: { spam: "junk" },
    };
    flow.start = "triage";
    expect(() => validateFlow(flow, defaultLeadSchema, defaultHitlPolicy)).toThrow(/pipelineByIntent/);
  });
});
