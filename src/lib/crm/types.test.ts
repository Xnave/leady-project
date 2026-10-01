import { describe, expect, it } from "vitest";
import {
  ACTIVE_STAGES,
  CLOSED_STAGES,
  isActiveStage,
  isClosedStage,
  isPipelineStage,
  stageRank,
} from "./types";

describe("crm types", () => {
  it("ranks the open pipeline in order", () => {
    expect(stageRank("new")).toBeLessThan(stageRank("talking"));
    expect(stageRank("talking")).toBeLessThan(stageRank("qualified"));
    expect(stageRank("qualified")).toBeLessThan(stageRank("pending"));
    expect(stageRank("pending")).toBeLessThan(stageRank("won"));
  });

  it("gives closed stages no rank", () => {
    expect(stageRank("lost")).toBe(-1);
    expect(stageRank("not_relevant")).toBe(-1);
  });

  it("classifies stages", () => {
    expect(ACTIVE_STAGES).toEqual(["new", "talking", "qualified", "pending"]);
    expect(CLOSED_STAGES).toEqual(["lost", "not_relevant"]);
    expect(isActiveStage("pending")).toBe(true);
    expect(isActiveStage("won")).toBe(false);
    expect(isClosedStage("not_relevant")).toBe(true);
    expect(isPipelineStage("won")).toBe(true);
    expect(isPipelineStage("open")).toBe(false);
    expect(isPipelineStage(undefined)).toBe(false);
  });
});
