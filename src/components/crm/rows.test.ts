import { describe, expect, it } from "vitest";
import type { LeadRowDTO } from "@/lib/crm/view";
import { isSnoozable, matchesView, restoreRows, withNextStep, withStage } from "./rows";

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
