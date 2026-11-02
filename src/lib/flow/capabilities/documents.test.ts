import { describe, expect, it } from "vitest";
import type { TalkOutcome, TurnContext } from "../types";
import { reconcileDocuments } from "./documents";

function ctx(runIngest: boolean): TurnContext {
  return {
    tenantId: "t1",
    agent: {
      id: "a1",
      tenantId: "t1",
      systemPrompt: "",
      knowledgeText: "",
      flow: { start: "talk", restartPolicy: { onNewMessage: "fallback" }, stages: {} },
      flowVersion: 1,
      leadSchema: { fields: {} },
      hitlPolicy: { allowRequestHuman: true, allowedFromStages: [] },
    },
    conversation: {
      id: "c1",
      status: "open",
      flowState: "talk",
      flowVersion: 1,
      nudgeCountByStage: {},
    },
    lead: { id: "l1", externalUserId: "+1", fields: {} },
    messages: [],
    capabilityState: {
      documents: {
        configured: true,
        runIngest,
        status: "gathering",
        activeStage: "identity",
        missing: ["ID card"],
      },
    },
  };
}

describe("reconcileDocuments", () => {
  it("forces ingest and drops a completion while a file is waiting", () => {
    const outcome: TalkOutcome = {
      reply: "ID card was received.",
      nextStage: "done",
      complete: true,
    };
    const next = reconcileDocuments({ ctx: ctx(true), outcome });
    expect(next.effects?.map((effect) => effect.type)).toContain("ingest_document");
    expect(next.nextStage).toBeUndefined();
    expect(next.complete).toBe(false);
  });

  it("leaves an ordinary reply alone when nothing is waiting", () => {
    const outcome: TalkOutcome = { reply: "What else can I help with?" };
    expect(reconcileDocuments({ ctx: ctx(false), outcome })).toEqual(outcome);
  });
});
