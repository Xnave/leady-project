import { describe, expect, it } from "vitest";
import { planLeadState, type LeadStateSnapshot } from "./plan";

const now = new Date("2026-09-25T09:00:00Z");
const t0 = new Date("2026-09-20T09:00:00Z");

function snapshot(over: Partial<LeadStateSnapshot> = {}): LeadStateSnapshot {
  return {
    current: {
      stage: "new",
      stageSource: "auto",
      stageReason: "first_message",
      stageChangedAt: t0,
      followUpReason: null,
      followUpAt: null,
      snoozedUntil: null,
      nextStepAt: null,
      lastLeadMessageAt: null,
      lastOutboundAt: null,
    },
    signals: { flow: null, currentFlowStage: null, fields: {}, hasAgentReply: false, requests: [] },
    openHandoffSince: null,
    pendingApprovalSince: null,
    lastLeadMessageAt: null,
    lastOutboundAt: null,
    lastRequestChangeAt: null,
    ...over,
  };
}

describe("planLeadState", () => {
  it("is a no-op when nothing changed", () => {
    expect(planLeadState(snapshot(), now)).toEqual({ patch: {}, stageEvent: null });
  });

  it("moves the stage and records an event", () => {
    const plan = planLeadState(
      snapshot({ signals: { flow: null, currentFlowStage: null, fields: {}, hasAgentReply: true, requests: [] } }),
      now,
    );
    expect(plan.patch.stage).toBe("talking");
    expect(plan.patch.stageChangedAt).toEqual(now);
    expect(plan.stageEvent).toEqual({ from: "new", to: "talking", source: "auto", reason: "engaged" });
  });

  it("writes message timestamps and the cold follow-up", () => {
    const lastOut = new Date("2026-09-24T09:00:00Z");
    const plan = planLeadState(
      snapshot({
        signals: { flow: null, currentFlowStage: null, fields: {}, hasAgentReply: true, requests: [] },
        lastLeadMessageAt: new Date("2026-09-24T08:00:00Z"),
        lastOutboundAt: lastOut,
      }),
      now,
    );
    expect(plan.patch.lastOutboundAt).toEqual(lastOut);
    expect(plan.patch.followUpReason).toBe("cold");
    expect(plan.patch.followUpAt).toEqual(new Date("2026-09-25T05:00:00Z"));
  });

  it("clears a snooze when the episode changes", () => {
    const plan = planLeadState(
      snapshot({
        current: {
          ...snapshot().current,
          stage: "talking",
          followUpReason: "cold",
          followUpAt: new Date("2026-09-24T05:00:00Z"),
          snoozedUntil: new Date("2026-09-27T06:00:00Z"),
        },
        signals: { flow: null, currentFlowStage: null, fields: {}, hasAgentReply: true, requests: [] },
        lastLeadMessageAt: new Date("2026-09-25T08:00:00Z"),
        lastOutboundAt: new Date("2026-09-24T09:00:00Z"),
      }),
      now,
    );
    expect(plan.patch.followUpReason).toBeNull();
    expect(plan.patch.snoozedUntil).toBeNull();
  });

  it("updates only the reason when source and stage are unchanged", () => {
    const plan = planLeadState(
      snapshot({
        current: { ...snapshot().current, stage: "talking", stageReason: "old" },
        signals: { flow: null, currentFlowStage: null, fields: {}, hasAgentReply: true, requests: [] },
      }),
      now,
    );
    expect(plan.patch).toEqual({ stageReason: "engaged" });
    expect(plan.stageEvent).toBeNull();
  });
});
