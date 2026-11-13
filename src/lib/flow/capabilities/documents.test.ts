import { describe, expect, it } from "vitest";
import type { TalkOutcome, TurnContext } from "../types";
import { documentsBeforeTalk, reconcileDocuments } from "./documents";

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
    messages: [{ role: "agent", text: "שלום", createdAt: new Date() }],
    capabilityState: {
        documents: {
          configured: true,
          runIngest,
          unsupportedOnly: false,
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

  it("does not add the unrecognized line to the reply", () => {
    const waiting = ctx(false);
    waiting.tenant = { id: "t1", name: "Office", chatLanguage: "en" } as unknown as TurnContext["tenant"];
    const bag = waiting.capabilityState;
    if (!bag) throw new Error("documents state missing");
    const documents = bag.documents as { sayUnrecognized?: boolean; unrecognized?: boolean };
    documents.sayUnrecognized = true;
    documents.unrecognized = true;
    const first = reconcileDocuments({ ctx: waiting, outcome: { reply: "Hours are 9 to 5." } });
    expect(first.reply).toBe("Hours are 9 to 5.");
    expect(first.effects).toBeUndefined();
  });

  it("leaves an ordinary reply alone when nothing is waiting", () => {
    const outcome: TalkOutcome = { reply: "What else can I help with?" };
    expect(reconcileDocuments({ ctx: ctx(false), outcome })).toEqual(outcome);
  });

  it("lets the first hello stay the intro", () => {
    const first = ctx(true);
    first.messages = [{ role: "lead", text: "שלום", createdAt: new Date() }];
    const outcome: TalkOutcome = { reply: "היי, אני העוזרת." };
    expect(reconcileDocuments({ ctx: first, outcome })).toEqual(outcome);
  });
});

describe("documentsBeforeTalk", () => {
  it("skips the model when every new file is an unsupported type", () => {
    const state = ctx(true);
    const bag = state.capabilityState;
    if (!bag) throw new Error("documents state missing");
    const documents = bag.documents as { unsupportedOnly: boolean };
    documents.unsupportedOnly = true;
    expect(documentsBeforeTalk(state)?.effects?.map((effect) => effect.type)).toEqual(["ingest_document"]);
  });

  it("lets the model run when a file still needs reading", () => {
    expect(documentsBeforeTalk(ctx(true))).toBeUndefined();
  });
});
