import { applyBookingCollect, defaultBookingCollect } from "./booking-collect";
import type { BookingCollectId } from "./booking-collect";
import { enPrompts, languageSystemRule } from "@/lib/copy";
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
    blurb: "Answer questions first; invite a visit only when they ask or need a human.",
  },
  {
    id: "book",
    title: "Booking",
    blurb: "Biased toward setting a meeting after a short qualify.",
  },
  {
    id: "faq",
    title: "FAQ only",
    blurb: "Answer from your intro and files. No booking.",
  },
];

const DISPLAY_ORDER = ["talk", "escalate", "waiting_human", "done"] as const;

function talkFlow(opts: {
  prompt: string;
  allowBook: boolean;
  requiredForBook?: BookingCollectId[];
}): FlowDefinition {
  const collect = opts.requiredForBook ?? defaultBookingCollect;
  return applyBookingCollect(
    {
      start: "talk",
      restartPolicy: { onNewMessage: "fallback", fallbackStage: "talk" },
      displayOrder: [...DISPLAY_ORDER],
      stages: {
        talk: {
          type: "talk",
          prompt: opts.prompt,
          allowBook: opts.allowBook,
          required_for_book: collect,
          capabilities: opts.allowBook ? ["booking"] : [],
          on_complete: "done",
          on_escalate: "escalate",
        },
        escalate: {
          type: "action",
          action: "request_human",
          on_complete: "waiting_human",
          on_fail: "talk",
        },
        waiting_human: { type: "terminal" },
        done: { type: "terminal" },
      },
    },
    collect,
  );
}

export function flowForCatalog(
  id: CatalogId,
  requiredForBook: BookingCollectId[] = defaultBookingCollect,
): FlowDefinition {
  const fields = requiredForBook.join(", ");
  if (id === "book") {
    return talkFlow({
      allowBook: true,
      requiredForBook,
      prompt: enPrompts.catalogBook(fields),
    });
  }
  if (id === "faq") {
    return talkFlow({
      allowBook: false,
      requiredForBook,
      prompt: enPrompts.catalogFaq,
    });
  }
  return talkFlow({
    allowBook: true,
    requiredForBook,
    prompt: enPrompts.catalogInbox(fields),
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
  return [languageSystemRule(chatLanguage), enPrompts.systemRole(name, intro, phone)]
    .filter(Boolean)
    .join("\n");
}
