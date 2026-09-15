import { applyBookingCollect, defaultBookingCollect } from "./booking-collect";
import type { BookingCollectId } from "./booking-collect";
import { enPrompts, languageSystemRule } from "@/lib/copy";
import type { FlowDefinition, HitlPolicy, NudgeSpec, Stage, TalkStage } from "./types";
import type { ChatLanguage } from "./locale";

/** Display / migration ids. `book` is legacy → inbox + proactive stance. */
export type CatalogId = "inbox" | "faq";
export type LegacyCatalogId = CatalogId | "book";
export type BookingStance = "passive" | "proactive";
export type CapabilityId = "booking" | "orders" | "docs";

export type FlowBuildOpts = {
  capabilities?: CapabilityId[];
  bookingStance?: BookingStance;
  requiredForBook?: BookingCollectId[];
};

export const catalogMeta: {
  id: CatalogId;
  title: string;
  blurb: string;
}[] = [
  {
    id: "inbox",
    title: "Assist",
    blurb: "Answer questions; enable capabilities (e.g. booking) as needed.",
  },
  {
    id: "faq",
    title: "FAQ only",
    blurb: "Answer from your intro and files. No transactional capabilities.",
  },
];

const DISPLAY_ORDER = ["talk", "escalate", "waiting_human", "done"] as const;

export const defaultTalkNudge: NudgeSpec = {
  after: "PT1H",
  template:
    "Brief follow-up after silence: invite them to continue the same thread; re-ask the last open question if there was one; stay warm and short.",
};

export function nudgeSpecForStage(stage: Stage): NudgeSpec | undefined {
  if (stage.nudge) return stage.nudge;
  if (stage.type === "talk") return defaultTalkNudge;
  return undefined;
}

export function normalizeCatalogId(raw: string | undefined | null): CatalogId {
  if (raw === "faq") return "faq";
  // legacy "book" → inbox (stance recovered separately)
  return "inbox";
}

export function isCatalogId(value: string): value is CatalogId {
  return value === "inbox" || value === "faq";
}

export function isLegacyCatalogId(value: string): value is LegacyCatalogId {
  return value === "inbox" || value === "faq" || value === "book";
}

export function isBookingStance(value: string): value is BookingStance {
  return value === "passive" || value === "proactive";
}

export function isCapabilityId(value: string): value is CapabilityId {
  return value === "booking" || value === "orders" || value === "docs";
}

/** Infer stance from legacy catalog or stored talk stage. */
export function resolveBookingStance(opts: {
  catalogId?: string | null;
  stage?: TalkStage;
  bookingStance?: string | null;
}): BookingStance {
  if (opts.bookingStance && isBookingStance(opts.bookingStance)) {
    return opts.bookingStance;
  }
  if (opts.stage?.bookingStance && isBookingStance(opts.stage.bookingStance)) {
    return opts.stage.bookingStance;
  }
  if (opts.catalogId === "book") return "proactive";
  return "passive";
}

function talkPromptFor(opts: {
  capabilities: CapabilityId[];
  bookingStance: BookingStance;
  fields: string;
}): string {
  const hasBooking = opts.capabilities.includes("booking");
  if (!hasBooking) return enPrompts.catalogFaq;
  if (opts.bookingStance === "proactive") {
    return enPrompts.catalogBook(opts.fields);
  }
  return enPrompts.catalogInbox(opts.fields);
}

function talkFlow(opts: {
  prompt: string;
  capabilities: CapabilityId[];
  bookingStance?: BookingStance;
  requiredForBook?: BookingCollectId[];
}): FlowDefinition {
  const collect = opts.requiredForBook ?? defaultBookingCollect;
  const allowBook = opts.capabilities.includes("booking");
  return applyBookingCollect(
    {
      start: "talk",
      restartPolicy: { onNewMessage: "fallback", fallbackStage: "talk" },
      displayOrder: [...DISPLAY_ORDER],
      stages: {
        talk: {
          type: "talk",
          prompt: opts.prompt,
          allowBook,
          required_for_book: allowBook ? collect : [],
          capabilities: [...opts.capabilities],
          bookingStance: allowBook ? opts.bookingStance ?? "passive" : undefined,
          on_complete: "done",
          on_escalate: "escalate",
          nudge: { ...defaultTalkNudge },
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
    allowBook ? collect : [],
  );
}

/** Preferred builder: capabilities + optional booking stance. */
export function flowForCapabilities(opts: FlowBuildOpts = {}): FlowDefinition {
  const capabilities = (opts.capabilities ?? []).filter(isCapabilityId);
  const bookingStance = opts.bookingStance ?? "passive";
  const requiredForBook = opts.requiredForBook ?? defaultBookingCollect;
  const fields = requiredForBook.join(", ");
  return talkFlow({
    capabilities,
    bookingStance,
    requiredForBook,
    prompt: talkPromptFor({ capabilities, bookingStance, fields }),
  });
}

/**
 * Legacy catalog entrypoint. `book` maps to booking + proactive stance.
 * Prefer flowForCapabilities for new code.
 */
export function flowForCatalog(
  id: LegacyCatalogId | string,
  requiredForBook: BookingCollectId[] = defaultBookingCollect,
): FlowDefinition {
  if (id === "faq") {
    return flowForCapabilities({ capabilities: [], requiredForBook });
  }
  if (id === "book") {
    return flowForCapabilities({
      capabilities: ["booking"],
      bookingStance: "proactive",
      requiredForBook,
    });
  }
  return flowForCapabilities({
    capabilities: ["booking"],
    bookingStance: "passive",
    requiredForBook,
  });
}

export function hitlForCatalog(_id?: string): HitlPolicy {
  return {
    allowRequestHuman: true,
    allowedFromStages: ["talk", "escalate"],
    allowedIntents: ["sales", "support", "other"],
    minConfidence: 0.4,
  };
}

/** Derive display catalog from capabilities (for channels/demo labels). */
export function catalogIdFromCapabilities(capabilities: string[]): CatalogId {
  return capabilities.includes("booking") ? "inbox" : "faq";
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
