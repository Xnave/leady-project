import { describe, expect, it } from "vitest";
import { defaultFlow, defaultHitlPolicy, defaultLeadSchema, validateFlow } from "./validate";
import { FlowConfigError } from "./types";
import { salesOrSupportFlow } from "./templates";

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
