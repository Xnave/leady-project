import { describe, expect, it } from "vitest";
import { deriveLeadStage, pickAutoStage } from "./stage";
import type { StageSignal } from "./types";

const t0 = new Date("2026-09-20T10:00:00Z");
const later = new Date("2026-09-21T10:00:00Z");
const earlier = new Date("2026-09-19T10:00:00Z");
const sig = (stage: StageSignal["stage"], reason: string = stage): StageSignal => ({ stage, reason });

describe("pickAutoStage", () => {
  it("defaults to new with no signals", () => {
    expect(pickAutoStage([]).stage).toBe("new");
  });
  it("picks the highest ranked signal", () => {
    expect(pickAutoStage([sig("new"), sig("pending"), sig("talking")]).stage).toBe("pending");
    expect(pickAutoStage([sig("won"), sig("pending")]).stage).toBe("won");
  });
  it("keeps the first reason on equal rank", () => {
    expect(pickAutoStage([sig("talking", "a"), sig("talking", "b")]).reason).toBe("a");
  });
  it("uses an automatic not_relevant only while nothing above talking is signalled", () => {
    expect(pickAutoStage([sig("talking"), sig("not_relevant", "intent")]).stage).toBe("not_relevant");
    expect(pickAutoStage([sig("pending"), sig("not_relevant")]).stage).toBe("pending");
  });
  it("never derives lost automatically", () => {
    expect(pickAutoStage([sig("lost"), sig("talking")]).stage).toBe("talking");
  });
});

describe("deriveLeadStage", () => {
  const base = { lastLeadMessageAt: null, lastRequestChangeAt: null };

  it("follows signals in auto mode", () => {
    const d = deriveLeadStage({
      ...base,
      current: { stage: "new", source: "auto", reason: "", changedAt: t0 },
      signals: [sig("talking", "engaged")],
    });
    expect(d).toEqual({ stage: "talking", source: "auto", reason: "engaged" });
  });

  it("holds a manual ranked stage against lower or equal signals", () => {
    const d = deriveLeadStage({
      ...base,
      current: { stage: "qualified", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("talking")],
    });
    expect(d).toEqual({ stage: "qualified", source: "manual", reason: "" });
  });

  it("lets a higher signal break a manual ranked stage when the lead writes after it", () => {
    const d = deriveLeadStage({
      ...base,
      lastLeadMessageAt: later,
      current: { stage: "qualified", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("pending", "request:pending")],
    });
    expect(d).toEqual({ stage: "pending", source: "auto", reason: "request:pending" });
  });

  it("holds a manual qualified stage against a pre-existing pending signal", () => {
    const d = deriveLeadStage({
      ...base,
      lastLeadMessageAt: earlier,
      lastRequestChangeAt: earlier,
      current: { stage: "qualified", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("pending", "request:pending")],
    });
    expect(d).toEqual({ stage: "qualified", source: "manual", reason: "" });
  });

  it("holds a manual talking stage against a qualified signal", () => {
    const d = deriveLeadStage({
      ...base,
      current: { stage: "talking", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("qualified")],
    });
    expect(d).toEqual({ stage: "talking", source: "manual", reason: "" });
  });

  it("holds a manual new stage against a qualified signal", () => {
    const d = deriveLeadStage({
      ...base,
      current: { stage: "new", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("qualified")],
    });
    expect(d).toEqual({ stage: "new", source: "manual", reason: "" });
  });

  it("lets a won signal break a manual qualified stage only on a request change after it", () => {
    const d = deriveLeadStage({
      ...base,
      lastRequestChangeAt: later,
      current: { stage: "qualified", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("won")],
    });
    expect(d).toEqual({ stage: "won", source: "auto", reason: "won" });
  });

  it("lets a won signal break a manual qualified stage on a new lead message after it", () => {
    const d = deriveLeadStage({
      ...base,
      lastLeadMessageAt: later,
      current: { stage: "qualified", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("won")],
    });
    expect(d).toEqual({ stage: "won", source: "auto", reason: "won" });
  });

  it("keeps a manual talking stage against a won signal with no new evidence", () => {
    const d = deriveLeadStage({
      ...base,
      lastLeadMessageAt: earlier,
      lastRequestChangeAt: earlier,
      current: { stage: "talking", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("won")],
    });
    expect(d).toEqual({ stage: "talking", source: "manual", reason: "" });
  });

  it("lets a request change after the manual choice return to auto", () => {
    const d = deriveLeadStage({
      ...base,
      lastRequestChangeAt: later,
      current: { stage: "won", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("pending", "request:pending")],
    });
    expect(d.source).toBe("auto");
    expect(d.stage).toBe("pending");
  });

  it("keeps a manual won when the customer writes again", () => {
    const d = deriveLeadStage({
      ...base,
      lastLeadMessageAt: later,
      current: { stage: "won", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("talking")],
    });
    expect(d.stage).toBe("won");
    expect(d.source).toBe("manual");
  });

  it("never lets a signal outrank a manual lost or not_relevant", () => {
    for (const closed of ["lost", "not_relevant"] as const) {
      const d = deriveLeadStage({
        ...base,
        current: { stage: closed, source: "manual", reason: "price", changedAt: t0 },
        signals: [sig("won")],
      });
      expect(d).toEqual({ stage: closed, source: "manual", reason: "price" });
    }
  });

  it("revives a manual lost lead that writes again", () => {
    const d = deriveLeadStage({
      ...base,
      lastLeadMessageAt: later,
      current: { stage: "lost", source: "manual", reason: "price", changedAt: t0 },
      signals: [sig("talking")],
    });
    expect(d).toEqual({ stage: "talking", source: "auto", reason: "revived" });
  });

  it("does not revive on a message older than the manual choice", () => {
    const d = deriveLeadStage({
      ...base,
      lastLeadMessageAt: earlier,
      current: { stage: "not_relevant", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("talking")],
    });
    expect(d.stage).toBe("not_relevant");
  });

  it("revives a closed lead on a newer request change", () => {
    const d = deriveLeadStage({
      ...base,
      lastRequestChangeAt: later,
      current: { stage: "lost", source: "manual", reason: "", changedAt: t0 },
      signals: [sig("pending", "request:pending")],
    });
    expect(d).toEqual({ stage: "pending", source: "auto", reason: "request:pending" });
  });
});
