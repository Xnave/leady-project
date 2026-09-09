import type { FlowDefinition } from "./types";

export const salesOrSupportFlow: FlowDefinition = {
  start: "classify_intent",
  restartPolicy: { onNewMessage: "fallback", fallbackStage: "answer_support" },
  stages: {
    classify_intent: {
      type: "classify",
      prompt:
        "Decide if this person wants to buy/book (sales) or has a product question (support). Default sales if mixed.",
      intents: ["sales", "support"],
      transitions: {
        sales: "collect_lead",
        support: "answer_support",
      },
    },
    collect_lead: {
      type: "collect",
      prompt: "Collect booking details. Be short. One question at a time.",
      required_fields: ["name", "email", "service"],
      optional_fields: ["budget", "time_preference"],
      ask_one_at_a_time: true,
      on_complete: "schedule",
      nudge: {
        after: "PT24H",
        template: "Still happy to help - want to finish booking?",
        maxTimes: 1,
      },
    },
    answer_support: {
      type: "faq",
      prompt: "Answer from Knowledge only. If you cannot, we escalate.",
      on_resolved: "done",
      on_unresolved: "escalate",
    },
    schedule: {
      type: "action",
      action: "book_meeting",
      on_complete: "done",
      on_fail: "collect_lead",
    },
    escalate: {
      type: "action",
      action: "request_human",
      on_complete: "waiting_human",
      on_fail: "done",
    },
    done: { type: "terminal" },
    waiting_human: { type: "terminal" },
  },
};
