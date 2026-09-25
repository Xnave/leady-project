import { describe, expect, it } from "vitest";
import { carrySnooze, deriveFollowUp, isFollowUpDue, waWindow } from "./followup";

const at = (iso: string) => new Date(iso);
const none = {
  openHandoffSince: null,
  pendingApprovalSince: null,
  nextStepAt: null,
  lastLeadMessageAt: null,
  lastOutboundAt: null,
};

describe("deriveFollowUp", () => {
  it("returns null when nothing applies", () => {
    expect(deriveFollowUp({ stage: "new", ...none })).toBeNull();
  });

  it("orders reasons handoff > approval > reminder > cold", () => {
    const all = {
      stage: "talking" as const,
      openHandoffSince: at("2026-09-25T08:00:00Z"),
      pendingApprovalSince: at("2026-09-25T07:00:00Z"),
      nextStepAt: at("2026-09-26T09:00:00Z"),
      lastLeadMessageAt: at("2026-09-24T08:00:00Z"),
      lastOutboundAt: at("2026-09-24T09:00:00Z"),
    };
    expect(deriveFollowUp(all)?.reason).toBe("handoff");
    expect(deriveFollowUp({ ...all, openHandoffSince: null })?.reason).toBe("approval");
    expect(deriveFollowUp({ ...all, openHandoffSince: null, pendingApprovalSince: null })?.reason).toBe(
      "reminder",
    );
  });

  it("marks cold 20h after our last message when the lead has not replied", () => {
    const fu = deriveFollowUp({
      stage: "qualified",
      ...none,
      lastLeadMessageAt: at("2026-09-24T08:00:00Z"),
      lastOutboundAt: at("2026-09-24T09:00:00Z"),
    });
    expect(fu).toEqual({ reason: "cold", at: at("2026-09-25T05:00:00Z") });
  });

  it("is not cold when the lead wrote last", () => {
    expect(
      deriveFollowUp({
        stage: "talking",
        ...none,
        lastLeadMessageAt: at("2026-09-24T10:00:00Z"),
        lastOutboundAt: at("2026-09-24T09:00:00Z"),
      }),
    ).toBeNull();
  });

  it("is not cold when we never wrote", () => {
    expect(deriveFollowUp({ stage: "new", ...none, lastLeadMessageAt: at("2026-09-24T10:00:00Z") })).toBeNull();
  });

  it("never marks closed or won stages cold", () => {
    for (const stage of ["won", "lost", "not_relevant"] as const) {
      expect(
        deriveFollowUp({ stage, ...none, lastOutboundAt: at("2026-09-20T09:00:00Z") }),
      ).toBeNull();
    }
  });

  it("replaces cold with the reminder once a next step is set", () => {
    const fu = deriveFollowUp({
      stage: "talking",
      ...none,
      lastOutboundAt: at("2026-09-20T09:00:00Z"),
      nextStepAt: at("2026-09-28T06:00:00Z"),
    });
    expect(fu).toEqual({ reason: "reminder", at: at("2026-09-28T06:00:00Z") });
  });

  it("keeps a handoff on a won lead", () => {
    const fu = deriveFollowUp({ stage: "won", ...none, openHandoffSince: at("2026-09-25T08:00:00Z") });
    expect(fu?.reason).toBe("handoff");
  });
});

describe("carrySnooze", () => {
  const prevCold = { reason: "cold", at: at("2026-09-25T05:00:00Z"), snoozedUntil: at("2026-09-26T06:00:00Z") };
  it("keeps the snooze for the same episode", () => {
    expect(carrySnooze(prevCold, { reason: "cold", at: at("2026-09-25T05:00:00Z") })).toEqual(
      at("2026-09-26T06:00:00Z"),
    );
  });
  it("drops the snooze when a new cold episode starts", () => {
    expect(carrySnooze(prevCold, { reason: "cold", at: at("2026-09-27T05:00:00Z") })).toBeNull();
  });
  it("drops the snooze when the reason changes or clears", () => {
    expect(carrySnooze(prevCold, { reason: "reminder", at: at("2026-09-25T05:00:00Z") })).toBeNull();
    expect(carrySnooze(prevCold, null)).toBeNull();
  });
});

describe("isFollowUpDue", () => {
  const now = at("2026-09-25T09:00:00Z");
  it("is due when the time has passed and it is not snoozed", () => {
    expect(isFollowUpDue({ reason: "cold", at: at("2026-09-25T05:00:00Z"), snoozedUntil: null }, now)).toBe(true);
  });
  it("is not due in the future", () => {
    expect(isFollowUpDue({ reason: "reminder", at: at("2026-09-26T05:00:00Z"), snoozedUntil: null }, now)).toBe(false);
  });
  it("is hidden while snoozed and due again afterwards", () => {
    const fu = { reason: "cold", at: at("2026-09-25T05:00:00Z"), snoozedUntil: at("2026-09-25T10:00:00Z") };
    expect(isFollowUpDue(fu, now)).toBe(false);
    expect(isFollowUpDue(fu, at("2026-09-25T10:00:00Z"))).toBe(true);
  });
  it("is never due without a reason", () => {
    expect(isFollowUpDue({ reason: null, at: null, snoozedUntil: null }, now)).toBe(false);
  });
});

describe("waWindow", () => {
  const now = at("2026-09-25T09:00:00Z");
  it("reports hours left rounded down", () => {
    expect(waWindow(at("2026-09-24T12:30:00Z"), now)).toEqual({
      closesAt: at("2026-09-25T12:30:00Z"),
      hoursLeft: 3,
      closed: false,
    });
  });
  it("is closed after 24h", () => {
    expect(waWindow(at("2026-09-24T08:00:00Z"), now).closed).toBe(true);
  });
  it("has no window without a lead message", () => {
    expect(waWindow(null, now)).toEqual({ closesAt: null, hoursLeft: null, closed: true });
  });
});
