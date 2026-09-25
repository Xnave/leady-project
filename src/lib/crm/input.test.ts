import { describe, expect, it } from "vitest";
import {
  parseNextStepBody,
  parseNoteBody,
  parseSnoozeBody,
  parseStageBody,
  snoozePresetUntil,
} from "./input";

const now = new Date("2026-09-25T09:00:00Z");

describe("crm input parsing", () => {
  it("accepts known stages with an optional reason", () => {
    expect(parseStageBody({ stage: "lost", reason: " price " })).toEqual({ stage: "lost", reason: "price" });
    expect(parseStageBody({ stage: "won" })).toEqual({ stage: "won", reason: "" });
    expect(parseStageBody({ stage: "open" })).toEqual({ error: "bad_stage" });
    expect(parseStageBody(null)).toEqual({ error: "bad_stage" });
  });

  it("caps the reason length", () => {
    const r = parseStageBody({ stage: "lost", reason: "x".repeat(500) });
    expect("reason" in r && r.reason.length).toBe(200);
  });

  it("parses a next step and the done action", () => {
    expect(parseNextStepBody({ text: "Call", at: "2026-09-26T06:00:00Z" }, now)).toEqual({
      text: "Call",
      at: new Date("2026-09-26T06:00:00Z"),
    });
    expect(parseNextStepBody({ done: true }, now)).toEqual({ text: null, at: null });
    expect(parseNextStepBody({ text: "Call" }, now)).toEqual({ error: "bad_date" });
    expect(parseNextStepBody({ text: "", at: "2026-09-26T06:00:00Z" }, now)).toEqual({
      text: null,
      at: new Date("2026-09-26T06:00:00Z"),
    });
  });

  it("parses snooze presets and explicit dates, never in the past", () => {
    expect(parseSnoozeBody({ days: 3 }, now)).toHaveProperty("until");
    expect(parseSnoozeBody({ until: "2026-09-20T00:00:00Z" }, now)).toEqual({ error: "bad_date" });
    expect(parseSnoozeBody({ days: 2 }, now)).toEqual({ error: "bad_days" });
  });

  it("snooze presets land at 09:00 local", () => {
    const until = snoozePresetUntil(1, now, "Asia/Jerusalem");
    // 2026-09-26 09:00 in Israel (UTC+3) = 06:00Z
    expect(until.toISOString()).toBe("2026-09-26T06:00:00.000Z");
  });

  it("validates notes", () => {
    expect(parseNoteBody({ body: "  hi  " })).toEqual({ body: "hi", pinned: false });
    expect(parseNoteBody({ body: "", pinned: true })).toEqual({ error: "empty" });
    expect(parseNoteBody({ body: "x".repeat(5001) })).toEqual({ error: "too_long" });
  });
});
