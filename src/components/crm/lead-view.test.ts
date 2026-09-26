import { describe, expect, it } from "vitest";
import {
  autoReasonKey,
  dateInputToIso,
  dayKey,
  dayLabel,
  isoToDateInput,
  manualStageActor,
  timelineMatches,
} from "./lead-view";

describe("autoReasonKey", () => {
  it("maps every stored reason shape to its copy key", () => {
    expect(autoReasonKey("request:stay:pending")).toBe("requestPending");
    expect(autoReasonKey("request:table:approved")).toBe("requestApproved");
    expect(autoReasonKey("flow:collect_dates")).toBe("flow");
    expect(autoReasonKey("intent:pricing")).toBe("intent");
    expect(autoReasonKey("collect:details")).toBe("collected");
    expect(autoReasonKey("contact_collected")).toBe("collected");
    expect(autoReasonKey("engaged")).toBe("engaged");
    expect(autoReasonKey("first_message")).toBe("first_message");
    expect(autoReasonKey("revived")).toBe("revived");
  });

  it("returns null for unknown or empty reasons", () => {
    expect(autoReasonKey("")).toBeNull();
    expect(autoReasonKey("Price")).toBeNull();
    expect(autoReasonKey("request:stay:declined")).toBeNull();
  });
});

describe("manualStageActor", () => {
  const item = (source: string, actor: string) => ({ id: source, at: "", kind: "stage" as const, data: { source, actor } });
  it("reads the actor of the newest stage item when it is manual", () => {
    const timeline = [
      { day: "2026-09-25", items: [{ id: "n", at: "", kind: "note" as const, data: {} }, item("manual", "Snir")] },
      { day: "2026-09-24", items: [item("auto", "")] },
    ];
    expect(manualStageActor({ stage: "lost", timeline })).toBe("Snir");
  });
  it("is empty when the newest stage item is automatic", () => {
    const timeline = [{ day: "2026-09-25", items: [item("auto", ""), item("manual", "Snir")] }];
    expect(manualStageActor({ stage: "talking", timeline })).toBe("");
  });
});

describe("timelineMatches", () => {
  it("filters by kind", () => {
    expect(timelineMatches("note", "all")).toBe(true);
    expect(timelineMatches("note", "notes")).toBe(true);
    expect(timelineMatches("stage", "notes")).toBe(false);
    expect(timelineMatches("stage", "stages")).toBe(true);
    expect(timelineMatches("request", "requests")).toBe(true);
    expect(timelineMatches("handoff", "requests")).toBe(false);
  });
});

describe("day helpers", () => {
  const now = new Date(2026, 8, 25, 15, 0);
  const labels = { today: "Today", yesterday: "Yesterday" };
  it("labels today and yesterday, otherwise formats the date", () => {
    expect(dayLabel("2026-09-25", now, "en", labels)).toBe("Today");
    expect(dayLabel("2026-09-24", now, "en", labels)).toBe("Yesterday");
    expect(dayLabel("2026-09-20", now, "en", labels)).toMatch(/20 Sept?/);
  });
  it("round-trips a date input at 09:00 local", () => {
    const iso = dateInputToIso("2026-10-01");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getHours()).toBe(9);
    expect(isoToDateInput(iso)).toBe("2026-10-01");
    expect(dateInputToIso("oops")).toBeNull();
    expect(dayKey(now)).toBe("2026-09-25");
  });
});
