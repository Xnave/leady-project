import { tool } from "ai";
import { z } from "zod";
import { capabilityState, registerCapability } from "../registry";
import type { TalkOutcome, TurnContext } from "../types";
import { hasAgentReplied } from "../intro";
import { copyFor } from "@/lib/copy";
import { documentsReplyLang } from "@/lib/documents/dossier";
import { documentAskText, loadDocumentsTurnState, type DocumentsTurnState } from "@/lib/documents/dossier";

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
  const outcome = opts.outcome;
  if (!state?.runIngest) return outcome;
  // The first turn is the intro. Checklist questions start on the next message,
  // unless a file already arrived and has to be stored.
  if (!hasAgentReplied(opts.ctx) && !state.pendingFile) return outcome;
  const effects = [...(opts.outcome.effects ?? [])];
  if (!effects.some((effect) => effect.type === "ingest_document")) {
    effects.push({ type: "ingest_document" });
  }
  return {
    ...outcome,
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
      if (state.unrecognized) {
        return [
          "This phone number is not in the office system. The first message already used the unrecognized intro.",
          "Answer the question. Do not say the number is missing, and do not ask for an ID or for documents.",
        ];
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
      const lang = documentsReplyLang(ctx);
      const chat = copyFor(lang, { gender: ctx.agent.persona?.gender }).chat;
      const next = state.asks?.[0];
      return [
        `Document checklist is in progress (${state.status}). Still missing at this stage: ${state.missing.join(", ") || "none"}.`,
        next
          ? [
              "If the customer just gave a useful fact, acknowledge it in one short clause, then ask only the question below.",
              "Do not open with אשמח, מעולה, הבנתי, or כדי להתקדם. Do not add a second question.",
              documentAskText(next, lang, chat),
            ].join("\n")
          : "Ask for the current stage's documents together. One file per message is fine; several in a row are fine.",
        "A file the customer sends is handled by ingest_document, including a file for a later stage.",
        "Never tell the customer a document was received unless ingest_document ran on this turn.",
        "Do not interview the customer about equity, income, timelines, or loan amounts. Stay on the missing document.",
        "If they say they do not have that document, explain how to get it and ask for it again. Drop the loan balance only when they explicitly say they have no loans.",
        "After a side question, answer it in one or two sentences and then ask that same next question again.",
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
