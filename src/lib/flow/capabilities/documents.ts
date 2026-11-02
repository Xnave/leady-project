import { tool } from "ai";
import { z } from "zod";
import { capabilityState, registerCapability } from "../registry";
import type { TalkOutcome, TurnContext } from "../types";
import { loadDocumentsTurnState, type DocumentsTurnState } from "@/lib/documents/dossier";

function documentsState(ctx: TurnContext): DocumentsTurnState | undefined {
  return capabilityState<DocumentsTurnState>(ctx, "documents");
}

/** Drop a "received" claim and force ingest when a file or a new checklist is waiting. */
export function reconcileDocuments(opts: {
  ctx: TurnContext;
  outcome: TalkOutcome;
}): TalkOutcome {
  const state = documentsState(opts.ctx);
  if (!state?.runIngest) return opts.outcome;
  const effects = [...(opts.outcome.effects ?? [])];
  if (!effects.some((effect) => effect.type === "ingest_document")) {
    effects.push({ type: "ingest_document" });
  }
  return {
    ...opts.outcome,
    effects,
    nextStage: undefined,
    complete: false,
  };
}

export function registerDocumentsCapability(): void {
  registerCapability({
    id: "documents",
    sessionFieldKeys: ["documents_national_id"],
    loadState: (args) => loadDocumentsTurnState(args),
    promptSection: ({ ctx }) => {
      const state = documentsState(ctx);
      if (!state?.configured) {
        return ["Document gathering is enabled but the SmartNPV connection or rules are not saved yet."];
      }
      if (state.status === "needs_id" || !state.status) {
        return [
          "A document checklist is on. Call ask_missing and ask for the national id if the checklist has not started.",
          "Never say a document was received unless ingest_document ran.",
        ];
      }
      if (state.status === "complete") {
        return ["The document checklist is complete. Do not ask for those documents again."];
      }
      return [
        `Document checklist is in progress (${state.status}). Still missing at this stage: ${state.missing.join(", ") || "none"}.`,
        "A file the customer sends is handled by ingest_document, including a file for a later stage.",
        "Ask for the current stage's documents together. One file per message is fine; several in a row are fine.",
        "Never tell the customer a document was received unless ingest_document ran on this turn.",
        "After a side question, answer it and then ask again for the missing documents in the agent's voice.",
      ];
    },
    tools: ({ ctx }) => ({
      ask_missing: tool({
        description: "List the documents still missing at the current stage. Use this to phrase the ask.",
        inputSchema: z.object({}),
        execute: async () => {
          const state = documentsState(ctx);
          return {
            status: state?.status ?? "",
            stage: state?.activeStage ?? "",
            missing: state?.missing ?? [],
          };
        },
      }),
    }),
    reconcile: ({ ctx, outcome }) => reconcileDocuments({ ctx, outcome }),
  });
}
