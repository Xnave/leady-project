import { describe, expect, it } from "vitest";
import { countsFromStageGroups } from "./view-rows";
import { FOLLOW_UP_PRIORITY, PIPELINE_STAGES } from "./types";

describe("countsFromStageGroups", () => {
  it("derives tab totals from pipeline groups plus queue extras", () => {
    const counts = countsFromStageGroups(
      [
        { pipelineStage: "new", count: 2 },
        { pipelineStage: "talking", count: 3 },
        { pipelineStage: "won", count: 1 },
        { pipelineStage: "lost", count: 4 },
      ],
      {
        needs: 5,
        cold: 6,
        byReason: { handoff: 1, approval: 2, reminder: 2, cold: 6 },
      },
    );
    expect(counts.needs).toBe(5);
    expect(counts.cold).toBe(6);
    expect(counts.active).toBe(5);
    expect(counts.won).toBe(1);
    expect(counts.closed).toBe(4);
    expect(counts.all).toBe(10);
    expect(counts.byStage.new).toBe(2);
    expect(counts.byStage.talking).toBe(3);
    expect(counts.byStage.qualified).toBe(0);
    expect(counts.byReason.approval).toBe(2);
  });

  it("covers every pipeline stage and follow-up reason", () => {
    const counts = countsFromStageGroups([], {
      needs: 0,
      cold: 0,
      byReason: { handoff: 0, approval: 0, reminder: 0, cold: 0 },
    });
    for (const st of PIPELINE_STAGES) expect(counts.byStage[st]).toBe(0);
    for (const r of FOLLOW_UP_PRIORITY) expect(counts.byReason[r]).toBe(0);
    expect(counts.all).toBe(0);
  });
});
