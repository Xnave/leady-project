import { describe, expect, it } from "vitest";
import { flowForCatalog } from "./catalog";
import {
  lastLeadMessageAt,
  leadRepliedSinceAnchor,
  resolveNudgeFireAt,
  shouldScheduleNudge,
} from "./helpers";
import type { TurnContext } from "./types";
import { defaultHitlPolicy, defaultLeadSchema } from "./validate";

const flow = flowForCatalog("inbox");
const talk = flow.stages.talk;

function ctx(extra?: Partial<TurnContext>): TurnContext {
  return {
    tenantId: "t1",
    tenant: {
      name: "Demo",
      phone: "",
      intro: "",
      chatLanguage: "en",
    },
    agent: {
      id: "a1",
      tenantId: "t1",
      systemPrompt: "",
      knowledgeText: "",
      flow,
      flowVersion: 1,
      leadSchema: defaultLeadSchema,
      hitlPolicy: defaultHitlPolicy,
    },
    conversation: {
      id: "c1",
      status: "open",
      flowState: "talk",
      flowVersion: 1,
      nudgeCountByStage: {},
    },
    lead: { id: "l1", externalUserId: "+1", fields: {} },
    messages: [{ role: "lead", text: "hi", createdAt: new Date("2026-09-19T12:00:00Z") }],
    ...extra,
  };
}

describe("shouldScheduleNudge", () => {
  it("schedules while talk is open", () => {
    expect(shouldScheduleNudge(ctx(), "talk", talk)).toBe(true);
  });

  it("does not schedule on a closed conversation", () => {
    expect(
      shouldScheduleNudge(
        ctx({
          conversation: {
            id: "c1",
            status: "closed",
            flowState: "talk",
            flowVersion: 1,
            nudgeCountByStage: {},
          },
        }),
        "talk",
        talk,
      ),
    ).toBe(false);
  });
});

describe("resolveNudgeFireAt", () => {
  it("returns last-lead plus duration when that instant is still ahead", () => {
    const at = resolveNudgeFireAt(
      new Date("2026-09-19T12:00:00Z"),
      "PT1H",
      new Date("2026-09-19T12:05:00Z"),
    );
    expect(at?.toISOString()).toBe("2026-09-19T13:00:00.000Z");
  });

  it("returns null when the reminder is already due", () => {
    expect(
      resolveNudgeFireAt(
        new Date("2026-09-19T11:00:00Z"),
        "PT1H",
        new Date("2026-09-19T12:05:00Z"),
      ),
    ).toBeNull();
  });
});

describe("lastLeadMessageAt", () => {
  it("ignores agent timestamps", () => {
    expect(
      lastLeadMessageAt(
        [
          { role: "lead", text: "a", createdAt: new Date("2026-09-19T12:00:00Z") },
          { role: "agent", text: "b", createdAt: new Date("2026-09-19T12:30:00Z") },
        ],
        new Date("2026-09-19T13:00:00Z"),
      ).toISOString(),
    ).toBe("2026-09-19T12:00:00.000Z");
  });
});

describe("leadRepliedSinceAnchor", () => {
  it("is false when the last lead is still the anchor", () => {
    expect(
      leadRepliedSinceAnchor(
        [{ role: "lead", text: "hi", createdAt: new Date("2026-09-19T12:00:00Z") }],
        "2026-09-19T12:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("is true when the lead wrote later", () => {
    expect(
      leadRepliedSinceAnchor(
        [
          { role: "lead", text: "hi", createdAt: new Date("2026-09-19T12:00:00Z") },
          { role: "agent", text: "ok", createdAt: new Date("2026-09-19T12:01:00Z") },
          { role: "lead", text: "still here", createdAt: new Date("2026-09-19T12:30:00Z") },
        ],
        "2026-09-19T12:00:00.000Z",
      ),
    ).toBe(true);
  });
});
