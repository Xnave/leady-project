import type { FlowDefinition, LeadFields, TurnContext } from "./types";

export type BookingCollectId =
  | "time_preference"
  | "name"
  | "phone"
  | "email"
  | "need"
  | "visit_kind";

export const bookingCollectMeta: {
  id: BookingCollectId;
  title: string;
  blurb: string;
  locked?: boolean;
}[] = [
  {
    id: "time_preference",
    title: "Day and time",
    blurb: "Always collected before a visit request.",
    locked: true,
  },
  {
    id: "name",
    title: "Name",
    blurb: "Full name — always collected; re-asked if only a nickname is known.",
    locked: true,
  },
  {
    id: "need",
    title: "Need / meeting purpose",
    blurb: "What they want covered in the visit.",
  },
  {
    id: "phone",
    title: "Phone",
    blurb: "Ask when missing; confirm when the chat number can be deduced (WhatsApp).",
  },
  {
    id: "email",
    title: "Email",
    blurb: "Only if you want email as well as (or instead of) phone.",
  },
  {
    id: "visit_kind",
    title: "Visit type",
    blurb: "Whatever kinds of visit this business offers (the agent will ask in their words).",
  },
];

export const defaultBookingCollect: BookingCollectId[] = [
  "time_preference",
  "name",
  "need",
];

export function isBookingCollectId(value: string): value is BookingCollectId {
  return bookingCollectMeta.some((item) => item.id === value);
}

export function sanitizeBookingCollect(raw: unknown): BookingCollectId[] {
  if (!Array.isArray(raw)) return [...defaultBookingCollect];
  const picked = raw
    .filter((item): item is string => typeof item === "string")
    .filter(isBookingCollectId);
  // Name + time are always collected (name may be re-asked if nickname-only).
  return [...new Set<BookingCollectId>(["time_preference", "name", ...picked])];
}

export function bookingCollectFromFlow(flow: FlowDefinition | null | undefined): BookingCollectId[] {
  const talk = flow?.stages.talk;
  if (talk?.type !== "talk" || !talk.required_for_book?.length) {
    return [...defaultBookingCollect];
  }
  return sanitizeBookingCollect(talk.required_for_book);
}

export function applyBookingCollect(
  flow: FlowDefinition,
  collect: BookingCollectId[],
): FlowDefinition {
  const next = structuredClone(flow);
  const talk = next.stages.talk;
  if (talk?.type === "talk") {
    talk.required_for_book = sanitizeBookingCollect(collect);
  }
  return next;
}

export function bookingRequiredFields(ctx: TurnContext): string[] {
  const current = ctx.agent.flow.stages[ctx.conversation.flowState];
  if (current?.type === "talk" && current.required_for_book?.length) {
    return current.required_for_book;
  }
  const start = ctx.agent.flow.stages[ctx.agent.flow.start];
  if (start?.type === "talk" && start.required_for_book?.length) {
    return start.required_for_book;
  }
  return [...defaultBookingCollect];
}

export function looksLikePhoneNumber(value: string): boolean {
  return /^\+?\d[\d\s-]{7,}\d$/.test(value.trim());
}

export function callbackPhone(ctx: TurnContext): string | undefined {
  const stored = String(ctx.lead.fields.phone ?? "").trim();
  if (stored) return stored;
  const fromChannel = ctx.channel?.customerPhone?.trim();
  if (fromChannel && looksLikePhoneNumber(fromChannel)) return fromChannel;
  const fromId = ctx.lead.externalUserId?.trim() ?? "";
  if (looksLikePhoneNumber(fromId)) return fromId;
  return undefined;
}

/** Required booking fields as configured - never drop phone for demo/IG. */
export function effectiveBookingRequired(ctx: TurnContext): string[] {
  return bookingRequiredFields(ctx);
}

/**
 * Phone already saved on the lead (after ask or confirm). Does not invent from the
 * channel - use {@link callbackPhone} when you need a candidate to confirm.
 */
export function savedPhone(fields: LeadFields): string {
  return String(fields.phone ?? "").trim();
}

export function withKnownPhone(ctx: TurnContext, fields: LeadFields): LeadFields {
  const phone = savedPhone(fields) || savedPhone(ctx.lead.fields) || callbackPhone(ctx);
  if (!phone) return fields;
  return { ...fields, phone };
}
