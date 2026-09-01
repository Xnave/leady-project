import type { FlowDefinition, HitlPolicy } from "./types";
import type { ChatLanguage } from "./locale";

export type CatalogId = "inbox" | "book" | "faq";

export const catalogMeta: {
  id: CatalogId;
  title: string;
  blurb: string;
}[] = [
  {
    id: "inbox",
    title: "Inbox (recommended)",
    blurb: "Greet, answer questions, then qualify and book when they want help.",
  },
  {
    id: "book",
    title: "Booking",
    blurb: "Same conversation style, biased toward setting a meeting.",
  },
  {
    id: "faq",
    title: "FAQ only",
    blurb: "Answer from your intro and files. No booking.",
  },
];

function talkFlow(opts: {
  prompt: string;
  allowBook: boolean;
}): FlowDefinition {
  return {
    start: "talk",
    restartPolicy: { onNewMessage: "fallback", fallbackStage: "talk" },
    stages: {
      talk: {
        type: "talk",
        prompt: opts.prompt,
        allowBook: opts.allowBook,
        required_for_book: ["time_preference", "name"],
        on_complete: "done",
        on_escalate: "escalate",
      },
      escalate: {
        type: "action",
        action: "request_human",
        on_complete: "waiting_human",
        on_fail: "talk",
      },
      done: { type: "terminal" },
      waiting_human: { type: "terminal" },
    },
  };
}

export function flowForCatalog(id: CatalogId): FlowDefinition {
  if (id === "book") {
    return talkFlow({
      allowBook: true,
      prompt:
        "You help people book a visit with the team. Be warm. You are not the designer. After a short qualify, invite a meeting. Collect name, phone or email, and a time. Never ask if they need the address — it is sent after the request is saved.",
    });
  }
  if (id === "faq") {
    return talkFlow({
      allowBook: false,
      prompt:
        "You answer simple questions from the intro and knowledge. Do not collect booking details or offer meetings.",
    });
  }
  return talkFlow({
    allowBook: true,
    prompt:
        "Front-desk chat: greet, answer simple business questions, capture a few facts, then invite a meeting with a human. Never assume a service they did not ask for. When booking, collect name, phone or email, and a time only.",
  });
}

export function hitlForCatalog(_id: CatalogId): HitlPolicy {
  return {
    allowRequestHuman: true,
    allowedFromStages: ["talk", "escalate"],
    allowedIntents: ["sales", "support", "other"],
    minConfidence: 0.4,
  };
}

export function isCatalogId(value: string): value is CatalogId {
  return value === "inbox" || value === "book" || value === "faq";
}

export function buildAgentSystemPrompt(
  name: string,
  intro: string,
  phone: string,
  chatLanguage: ChatLanguage = "en",
): string {
  const lang =
    chatLanguage === "he"
      ? "Always reply in Hebrew."
      : chatLanguage === "en"
        ? "Always reply in English."
        : "Reply in the customer's language (Hebrew or English). Do not mix.";
  return [
    `You represent ${name} as a front-desk assistant only — not a professional.`,
    lang,
    intro.trim(),
    phone.trim() ? `Public phone: ${phone.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
