import { describe, expect, it } from "vitest";
import { buildLeadTimeline, groupTimelineByDay } from "./timeline";

const d = (iso: string) => new Date(iso);
const empty = { stageEvents: [], notes: [], decisions: [], requests: [], handoffs: [], conversations: [] };

describe("buildLeadTimeline", () => {
  it("merges every source newest first", () => {
    const items = buildLeadTimeline({
      ...empty,
      stageEvents: [{ id: "s1", from: "new", to: "talking", source: "auto", reason: "engaged", actorUserId: null, createdAt: d("2026-09-25T10:00:00Z") }],
      notes: [{ id: "n1", body: "hi", authorLabel: "Snir", pinned: false, createdAt: d("2026-09-25T11:00:00Z") }],
      conversations: [{ id: "c1", status: "open", lifecycleReason: "inbound_create", createdAt: d("2026-09-25T09:00:00Z"), updatedAt: d("2026-09-25T09:00:00Z") }],
    });
    expect(items.map((i) => i.kind)).toEqual(["note", "stage", "conversation"]);
  });

  it("maps lead decisions to next_step and snooze, and skips stage decisions (stage events cover them)", () => {
    const items = buildLeadTimeline({
      ...empty,
      decisions: [
        { id: "a", category: "lead", action: "next_step_set", actorLabel: "S", details: { text: "Call" }, createdAt: d("2026-09-25T10:00:00Z") },
        { id: "b", category: "lead", action: "snooze", actorLabel: "S", details: {}, createdAt: d("2026-09-25T09:00:00Z") },
        { id: "c", category: "lead", action: "stage", actorLabel: "S", details: {}, createdAt: d("2026-09-25T08:00:00Z") },
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(["next_step", "snooze"]);
  });

  it("labels a manual stage event with its actor's name from the decision log", () => {
    const items = buildLeadTimeline({
      ...empty,
      stageEvents: [
        { id: "s1", from: "talking", to: "lost", source: "manual", reason: "Price", actorUserId: "u1", createdAt: d("2026-09-25T10:00:00Z") },
        { id: "s2", from: "new", to: "talking", source: "auto", reason: "engaged", actorUserId: null, createdAt: d("2026-09-25T09:00:00Z") },
      ],
      decisions: [{ id: "c", category: "lead", action: "stage", actorUserId: "u1", actorLabel: "Snir", details: {}, createdAt: d("2026-09-25T10:00:00Z") }],
    });
    expect(items.map((i) => i.data.actor)).toEqual(["Snir", ""]);
  });

  it("emits a closed conversation as a second item", () => {
    const items = buildLeadTimeline({
      ...empty,
      conversations: [{ id: "c1", status: "closed", lifecycleReason: "done", createdAt: d("2026-09-24T09:00:00Z"), updatedAt: d("2026-09-24T12:00:00Z") }],
    });
    expect(items.map((i) => i.data.event)).toEqual(["ended", "started"]);
  });
});

describe("groupTimelineByDay", () => {
  it("groups by local day in the tenant timezone", () => {
    const items = buildLeadTimeline({
      ...empty,
      notes: [
        { id: "n1", body: "a", authorLabel: "", pinned: false, createdAt: d("2026-09-24T22:30:00Z") }, // 25th in Israel
        { id: "n2", body: "b", authorLabel: "", pinned: false, createdAt: d("2026-09-24T20:00:00Z") }, // 24th in Israel
      ],
    });
    expect(groupTimelineByDay(items, "Asia/Jerusalem").map((g) => g.day)).toEqual(["2026-09-25", "2026-09-24"]);
  });
});
