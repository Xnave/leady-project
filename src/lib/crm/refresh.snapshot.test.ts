import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const groupBy = vi.fn();
const hitlFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    lead: { findFirst: (...a: unknown[]) => findFirst(...(a as [])) },
    conversation: { findFirst: vi.fn() },
    message: { groupBy: (...a: unknown[]) => groupBy(...(a as [])) },
    hitlTask: { findFirst: (...a: unknown[]) => hitlFindFirst(...(a as [])) },
  },
}));

const { loadLeadStateSnapshot } = await import("./refresh");

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    pipelineStage: "talking",
    pipelineStageSource: "auto",
    pipelineStageReason: "engaged",
    pipelineStageChangedAt: new Date("2026-10-01T00:00:00Z"),
    attentionReason: null,
    attentionAt: null,
    snoozedUntil: null,
    nextStepAt: null,
    lastLeadMessageAt: new Date("2026-10-05T10:00:00Z"),
    lastOutboundAt: new Date("2026-10-05T09:00:00Z"),
    fields: {},
    conversations: [{ flowState: "talk", agent: { flow: { start: "talk", stages: {} } } }],
    requests: [],
    hitlTasks: [],
    ...overrides,
  };
}

describe("loadLeadStateSnapshot clocks", () => {
  beforeEach(() => {
    findFirst.mockReset();
    groupBy.mockReset();
    hitlFindFirst.mockReset();
    hitlFindFirst.mockResolvedValue(null);
  });

  it("uses denormalized clocks and skips message.groupBy when either clock is set", async () => {
    findFirst.mockResolvedValue(leadRow());
    const snap = await loadLeadStateSnapshot("t1", "l1");
    expect(groupBy).not.toHaveBeenCalled();
    expect(snap?.lastLeadMessageAt?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
    expect(snap?.lastOutboundAt?.toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(snap?.signals.hasAgentReply).toBe(true);
  });

  it("falls back to groupBy when both denorm clocks are null", async () => {
    findFirst.mockResolvedValue(
      leadRow({ lastLeadMessageAt: null, lastOutboundAt: null }),
    );
    groupBy.mockResolvedValue([
      { role: "lead", _max: { createdAt: new Date("2026-10-04T12:00:00Z") } },
      { role: "agent", _max: { createdAt: new Date("2026-10-04T11:00:00Z") } },
    ]);
    const snap = await loadLeadStateSnapshot("t1", "l1");
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(snap?.lastLeadMessageAt?.toISOString()).toBe("2026-10-04T12:00:00.000Z");
    expect(snap?.lastOutboundAt?.toISOString()).toBe("2026-10-04T11:00:00.000Z");
  });
});
