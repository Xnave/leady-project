import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const groupBy = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    lead: { findFirst: (...a: unknown[]) => findFirst(...(a as [])) },
    conversation: { findFirst: vi.fn() },
    message: { groupBy: (...a: unknown[]) => groupBy(...(a as [])) },
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
  });

  it("uses denormalized clocks and skips message.groupBy when both clocks are set", async () => {
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

  it("scans when only one denorm clock is set and fills the missing field", async () => {
    findFirst.mockResolvedValue(leadRow({ lastLeadMessageAt: null }));
    groupBy.mockResolvedValue([
      { role: "lead", _max: { createdAt: new Date("2026-10-05T11:00:00Z") } },
      { role: "agent", _max: { createdAt: new Date("2026-10-05T08:00:00Z") } },
    ]);
    const snap = await loadLeadStateSnapshot("t1", "l1");
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(snap?.lastLeadMessageAt?.toISOString()).toBe("2026-10-05T11:00:00.000Z");
    // Denorm outbound wins over groupBy.
    expect(snap?.lastOutboundAt?.toISOString()).toBe("2026-10-05T09:00:00.000Z");
  });

  it("reads linkSent from the lead hitlTasks include (no extra query)", async () => {
    findFirst.mockResolvedValue(
      leadRow({
        hitlTasks: [{ type: "reservation_link_sent", createdAt: new Date("2026-10-05T08:00:00Z") }],
      }),
    );
    const snap = await loadLeadStateSnapshot("t1", "l1");
    expect(snap?.signals.linkSent).toBe(true);
  });
});
