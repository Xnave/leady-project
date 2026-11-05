import { tool } from "ai";
import { z } from "zod";
import { capabilityState, registerCapability } from "../registry";
import type { TalkOutcome, TurnContext } from "../types";
import { copyFor, replyLang } from "@/lib/copy";
import { loadDocumentsTurnState, type DocumentsTurnState } from "@/lib/documents/dossier";

function documentsState(ctx: TurnContext): DocumentsTurnState | undefined {
  return capabilityState<DocumentsTurnState>(ctx, "documents");
}

/** Skip the model when the only new files are types Smart NPV will not store. */
export function documentsBeforeTalk(ctx: TurnContext): TalkOutcome | undefined {
  const state = documentsState(ctx);
  if (!state?.unsupportedOnly) return undefined;
  return { reply: "", effects: [{ type: "ingest_document" }] };
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
      const chat = copyFor(replyLang(ctx), { gender: ctx.agent.persona?.gender }).chat;
      const asks = (state.asks ?? []).map((question) => {
        if (question.kind === "employment") return chat.documents.askEmployment(question.name || "the borrower");
        if (question.kind === "salary_deposit") return chat.documents.askSalaryDeposit(question.name || "the borrower");
        if (question.kind === "first_home") return chat.documents.askFirstHome;
        if (question.kind === "loans") return chat.documents.askLoans;
        if (question.kind === "more_loans") return chat.documents.askMoreLoans;
        if (question.kind === "more_photos") return chat.documents.askMorePhotos;
        return chat.documents.askAccounts;
      });
      return [
        `Document checklist is in progress (${state.status}). Still missing at this stage: ${state.missing.join(", ") || "none"}.`,
        asks.length ? `Ask these before treating the list as settled:\n${asks.join("\n")}` : "",
        "A file the customer sends is handled by ingest_document, including a file for a later stage.",
        "Ask for the current stage's documents together. One file per message is fine; several in a row are fine.",
        "Never tell the customer a document was received unless ingest_document ran on this turn.",
        "After a side question, answer it and then ask again for the missing documents in the agent's voice.",
      ].filter(Boolean);
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
    beforeTalk: ({ ctx }) => documentsBeforeTalk(ctx),
  });
}
