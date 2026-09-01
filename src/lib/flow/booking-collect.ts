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
    blurb: "How to address them on the booking.",
  },
  {
    id: "need",
    title: "Need / meeting purpose",
    blurb: "What they want covered in the visit.",
  },
  {
    id: "phone",
    title: "Phone",
    blurb: "On WhatsApp, this tenant's chat number is stored on the lead. Leave unchecked unless you want them to type a number.",
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
  return [...new Set<BookingCollectId>(["time_preference", ...picked])];
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

export function callbackPhone(ctx: TurnContext): string | undefined {
  const stored = String(ctx.lead.fields.phone ?? "").trim();
  if (stored) return stored;
  return ctx.channel?.customerPhone?.trim() || undefined;
}

export function withKnownPhone(ctx: TurnContext, fields: LeadFields): LeadFields {
  const phone =
    String(fields.phone ?? ctx.lead.fields.phone ?? "").trim() || callbackPhone(ctx);
  if (!phone) return fields;
  return { ...fields, phone };
}
