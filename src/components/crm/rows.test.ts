import { describe, expect, it } from "vitest";
import type { LeadRowDTO } from "@/lib/crm/view";
import { diffRow, isSnoozable, matchesView, mergePending, restoreRows, withNextStep, withSnooze, withStage, type PendingEdit } from "./rows";

const row = (o: Partial<LeadRowDTO> = {}): LeadRowDTO => ({
  id: "a",
  name: "Dana",
  handle: "+972",
  channel: "whatsapp",
  stage: "talking",
  stageSource: "auto",
  followUpReason: "cold",
  followUpAt: "2026-09-24T10:00:00.000Z",
  due: true,
  snoozedUntil: null,
  nextStepText: null,
  nextStepAt: null,
  stand: "asked about price",
  lastAt: "2026-09-24T10:00:00.000Z",
  lastBy: "us",
  windowHoursLeft: 2,
  windowClosed: false,
  unread: false,
  demo: false,
  intent: null,
  ...o,
});

describe("withStage", () => {
  it("drops a cold follow-up when the lead closes", () => {
    const r = withStage(row(), "lost");
    expect([r.stage, r.stageSource, r.followUpReason, r.due]).toEqual(["lost", "manual", null, false]);
    expect(matchesView(r, { tab: "needs" })).toBe(false);
  });
  it("keeps a handoff after a close", () => {
    const r = withStage(row({ followUpReason: "handoff" }), "won");
    expect(r.due).toBe(true);
  });
});

describe("withNextStep", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  it("turns a cold lead into a future reminder that leaves needs", () => {
    const r = withNextStep(row(), "call", "2026-09-26T06:00:00.000Z", now);
    expect([r.followUpReason, r.due, r.stand]).toEqual(["reminder", false, "call"]);
  });
  it("does not outrank an approval", () => {
    expect(withNextStep(row({ followUpReason: "approval" }), null, "2026-09-26T06:00:00.000Z", now).due).toBe(true);
  });
});

describe("matchesView / isSnoozable", () => {
  it("applies stage and channel filters", () => {
    expect(matchesView(row(), { tab: "all", stage: "new" })).toBe(false);
    expect(matchesView(row(), { tab: "active", channel: "instagram" })).toBe(false);
    expect(matchesView(row(), { tab: "active" })).toBe(true);
  });
  it("only snoozes due cold / reminder", () => {
    expect(isSnoozable(row())).toBe(true);
    expect(isSnoozable(row({ followUpReason: "handoff" }))).toBe(false);
    expect(isSnoozable(row({ due: false }))).toBe(false);
  });
});

describe("restoreRows", () => {
  it("reinserts removed rows at their index and replaces changed ones", () => {
    const a = row({ id: "a" });
    const b = row({ id: "b" });
    const c = row({ id: "c" });
    const cur = [a, withStage(c, "won")];
    const out = restoreRows(cur, [{ row: b, index: 1 }, { row: c, index: 2 }]);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out[2].stage).toBe("talking");
  });
});

describe("mergePending", () => {
  const edit = (before: LeadRowDTO, after: LeadRowDTO, o: Partial<PendingEdit> = {}): PendingEdit => ({
    token: 1,
    patch: diffRow(before, after),
    row: after,
    index: 0,
    settled: false,
    misses: 0,
    ...o,
  });

  it("keeps an in-flight stage change when a stale refresh lands", () => {
    const a = row({ id: "a" });
    const b = row({ id: "b" });
    const pending = new Map([["b", edit(b, withStage(b, "won"))]]);
    const out = mergePending([a, b], pending, { tab: "all" });
    expect(out.rows.map((r) => [r.id, r.stage])).toEqual([["a", "talking"], ["b", "won"]]);
    expect(out.drop).toEqual([]);
  });

  it("drops a settled edit once the server shows it", () => {
    const b = row({ id: "b" });
    const won = withStage(b, "won");
    const pending = new Map([["b", edit(b, won, { settled: true })]]);
    const out = mergePending([won], pending, { tab: "all" });
    expect(out.drop).toEqual(["b"]);
    expect(out.rows[0].stage).toBe("won");
  });

  it("re-applies a settled edit a stale refresh misses, then gives up", () => {
    const b = row({ id: "b" });
    const p = edit(b, withStage(b, "won"), { settled: true });
    const first = mergePending([b], new Map([["b", p]]), { tab: "all" });
    expect([first.rows[0].stage, first.missed]).toEqual(["won", ["b"]]);
    const second = mergePending([b], new Map([["b", { ...p, misses: 1 }]]), { tab: "all" });
    expect([second.rows[0].stage, second.drop]).toEqual(["talking", ["b"]]);
  });

  it("confirms a date-only next-step edit by its date, not by an empty field set", () => {
    const b = row({ id: "b", nextStepText: "call", nextStepAt: "2026-09-26T06:00:00.000Z", followUpReason: "reminder", due: false });
    const moved = withNextStep(b, "call", "2026-09-28T06:00:00.000Z");
    const p = edit(b, moved, { settled: true });
    expect(Object.keys(p.patch).sort()).toEqual(["followUpAt", "nextStepAt", "stand"]);
    const stale = mergePending([b], new Map([["b", p]]), { tab: "all" });
    expect([stale.rows[0].nextStepAt, stale.drop, stale.missed]).toEqual(["2026-09-28T06:00:00.000Z", [], ["b"]]);
    const fresh = mergePending([moved], new Map([["b", p]]), { tab: "all" });
    expect([fresh.rows[0].nextStepAt, fresh.drop]).toEqual(["2026-09-28T06:00:00.000Z", ["b"]]);
  });

  it("never confirms a patch made only of unstable fields", () => {
    const b = row({ id: "b" });
    const p = edit(b, { ...b, snoozedUntil: "2026-09-26T06:00:00.000Z" }, { settled: true });
    const out = mergePending([b], new Map([["b", p]]), { tab: "all" });
    expect([out.drop, out.missed]).toEqual([[], ["b"]]);
  });

  it("keeps a pending snooze out of needs you", () => {
    const a = row({ id: "a" });
    const b = row({ id: "b" });
    const pending = new Map([["a", edit(a, withSnooze(a, "2026-09-26T06:00:00.000Z"))]]);
    expect(mergePending([a, b], pending, { tab: "needs" }).rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("keeps an unsettled (optimistic peek) edit across any number of stale refreshes", () => {
    const b = row({ id: "b" });
    const p = edit(b, withNextStep(b, "call back", "2026-09-27T06:00:00.000Z"));
    const pending = new Map([["b", p]]);
    for (let i = 0; i < 5; i++) {
      const out = mergePending([b], pending, { tab: "all" });
      expect([out.rows[0].nextStepText, out.drop, out.missed]).toEqual(["call back", [], []]);
    }
    // Once settled (the peek's confirmed report), the next refresh that shows it drops it.
    const done = mergePending([p.row], new Map([["b", { ...p, settled: true }]]), { tab: "all" });
    expect(done.drop).toEqual(["b"]);
  });

  it("puts back a row the server has not returned yet (undo in flight)", () => {
    const a = row({ id: "a" });
    const b = row({ id: "b" });
    const pending = new Map([["b", edit(withStage(b, "lost"), b, { index: 0 })]]);
    expect(mergePending([a], pending, { tab: "needs" }).rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
