/**
 * The booking vertical: a visit is a `Request` with `kind: "visit"` and a
 * point-in-time spine. Persistence, HITL and the decision log live in
 * `@/lib/requests`; this module owns only booking's wording and field mapping.
 */
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  appendStaffNote,
  bookingVars,
  copyFor,
  renderBookingMessage,
} from "@/lib/copy";
import { askBookingField, bookingFieldGaps } from "@/lib/flow/booking";
import { bookingConfigFromCtx, parseBookingConfig } from "@/lib/flow/booking-config";
import { instanceKind } from "@/lib/flow/instances";
import { loadInstanceConfig } from "@/lib/capability-instances";
import {
  bookingRequiredFields,
  callbackPhone,
  savedPhone,
} from "@/lib/flow/booking-collect";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";
import { normalizeSlot } from "@/lib/flow/slot";
import { summarizeConversation } from "@/lib/flow/summarize";
import type { TurnContext } from "@/lib/flow/types";
import { persistTurnFields } from "@/lib/conversations";
import {
  createRequestWithApprovalTask,
  decideRequest,
  findPendingRequest,
  getRequest,
  loadRecentRequest,
  timeTextToStartAt,
  updateRequestData,
  type RequestRow,
} from "@/lib/requests";

/** Capability that owns visit requests. */
export const BOOKING_CAPABILITY = "booking";
/** Instance kind for a visit. */
export const VISIT_KIND = "visit";

function venueFromConfig(ctx: TurnContext): { address: string; hours: string } {
  const config = bookingConfigFromCtx(ctx);
  return { address: config.venueAddress, hours: config.venueHours };
}

function replyLangFromCtx(ctx: TurnContext): "en" | "he" {
  const last = [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
  return resolveReplyLanguage(ctx.tenant?.chatLanguage, last);
}

/** Typed values a visit request stores in `Request.data`. */
type VisitData = {
  need?: string;
  visit_kind?: string;
  venue?: string;
  hours?: string;
};

function visitData(row: RequestRow): VisitData {
  return row.data as VisitData;
}

function meetingMessageVars(opts: {
  lang: "en" | "he";
  slotRaw: string;
  address: string;
  hours: string;
  name: string;
  phone: string;
  email: string;
  need: string;
  kind: string;
  business: string;
  note?: string;
}) {
  const normalized = normalizeSlot(opts.slotRaw, { lang: opts.lang });
  return {
    ...bookingVars({
      slot: normalized.display,
      date: normalized.dateLabel,
      time: normalized.timeLabel || normalized.time || "",
      address: opts.address,
      hours: opts.hours,
      name: opts.name,
      phone: opts.phone,
      email: opts.email,
      need: opts.need,
      kind: opts.kind,
      business: opts.business,
    }),
    note: opts.note?.trim() ?? "",
  };
}

export async function requestTentativeMeeting(
  ctx: TurnContext,
): Promise<{ ok: boolean; reply: string }> {
  const lang = replyLangFromCtx(ctx);
  const fields = { ...ctx.lead.fields };
  const venue = venueFromConfig(ctx);
  const gaps = bookingFieldGaps(fields, bookingRequiredFields(ctx));
  if (gaps.length > 0) {
    return {
      ok: false,
      reply: askBookingField(lang, gaps[0], {
        hours: venue.hours,
        deducedPhone: gaps[0] === "phone" ? callbackPhone(ctx) : undefined,
      }),
    };
  }
  const phone = savedPhone(fields) || callbackPhone(ctx) || "";
  const slotRaw = String(fields.time_preference);
  const normalized = normalizeSlot(slotRaw, { lang });
  const visitKind = String(fields.visit_kind ?? "visit");
  const name = String(fields.name ?? "");
  const email = String(fields.email ?? "");
  const need = String(fields.need ?? "");
  const vars = meetingMessageVars({
    lang,
    slotRaw,
    address: venue.address,
    hours: venue.hours,
    name,
    phone,
    email,
    need,
    kind: visitKind,
    business: ctx.tenant?.name?.trim() || copyFor(lang).chat.fallbackTeamName,
  });
  const requestText = () =>
    renderBookingMessage(
      bookingConfigFromCtx(ctx).messageTemplates.request,
      copyFor(lang).chat.bookingRequestTemplate,
      vars,
    );

  const existing = await findPendingRequest({
    tenantId: ctx.tenantId,
    conversationId: ctx.conversation.id,
    capabilityId: BOOKING_CAPABILITY,
  });
  if (existing) {
    return { ok: true, reply: requestText() };
  }

  const summary = await summarizeConversation(ctx.conversation.id);
  const request = await createRequestWithApprovalTask({
    tenantId: ctx.tenantId,
    leadId: ctx.lead.id,
    conversationId: ctx.conversation.id,
    capabilityId: BOOKING_CAPABILITY,
    kind: instanceKind(ctx, BOOKING_CAPABILITY, VISIT_KIND),
    startAt: timeTextToStartAt(normalized.display),
    timeText: normalized.display,
    contactName: name,
    contactEmail: email,
    contactPhone: phone,
    data: {
      need,
      visit_kind: visitKind,
      venue: venue.address,
      hours: venue.hours,
    } satisfies VisitData,
    taskPayload: {
      need,
      slot: normalized.display,
      date: normalized.dateLabel,
      time: normalized.timeLabel || normalized.time || "",
      details: vars.details,
      summary,
    },
  });

  const nextFields = {
    ...fields,
    time_preference: normalized.display,
    phone,
    booking: {
      meetingId: request.id,
      status: "pending",
      when: normalized.display,
      kind: visitKind,
    },
    need,
    booking_confirm: "confirmed",
  };
  await persistTurnFields(ctx.tenantId, ctx.lead.id, ctx.conversation.id, nextFields);
  ctx.lead.fields = nextFields;

  await prisma.conversation.update({
    where: { id: ctx.conversation.id },
    data: { status: "waiting_human", flowState: "waiting_human" },
  });
  ctx.conversation.status = "waiting_human";
  ctx.conversation.flowState = "waiting_human";

  return { ok: true, reply: requestText() };
}

/** Latest still-relevant visit on the lead — for post-approval follow-ups in talk. */
export type RecentMeetingSnapshot = {
  id: string;
  status: string;
  slotText: string;
  needText: string;
  contactName: string;
  decidedAt?: string;
};

/**
 * State loader for the booking capability. Registered via `loadState` so
 * `loadTurnContext` never names this domain.
 */
export async function loadRecentMeeting(
  tenantId: string,
  leadId: string,
): Promise<RecentMeetingSnapshot | undefined> {
  const row = await loadRecentRequest({
    tenantId,
    leadId,
    capabilityId: BOOKING_CAPABILITY,
  });
  if (!row) return undefined;
  return {
    id: row.id,
    status: row.status,
    slotText: row.timeText,
    needText: visitData(row).need ?? "",
    contactName: row.contactName,
    decidedAt: row.decidedAt?.toISOString(),
  };
}

export type MeetingDecision = "approve" | "decline" | "reschedule";

export type StaffSlotOffer = {
  meetingId: string;
  slot: string;
  previousSlot: string;
};

function readStaffSlotOffer(fields: Record<string, unknown>): StaffSlotOffer | null {
  const raw = fields.staff_slot_offer;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.meetingId !== "string" || typeof rec.slot !== "string") return null;
  return {
    meetingId: rec.meetingId,
    slot: rec.slot,
    previousSlot: typeof rec.previousSlot === "string" ? rec.previousSlot : "",
  };
}

/** Pending staff-offered alternative slot waiting for the customer's answer. */
export function getStaffSlotOffer(
  fields: Record<string, unknown> | null | undefined,
): StaffSlotOffer | null {
  if (!fields) return null;
  return readStaffSlotOffer(fields);
}

export async function markMeetingDecision(opts: {
  tenantId: string;
  meetingId: string;
  actorUserId: string;
  decision: MeetingDecision;
  note?: string;
  customReply?: string;
  /** Required when decision is reschedule — shown to the customer as the offered slot */
  alternativeSlot?: string;
  /** When the customer accepted a staff-offered slot */
  customerConfirmed?: boolean;
}): Promise<{
  conversationId: string;
  leadId: string;
  text: string;
  /** Close as done after the outbound message is saved (no empty new conversation). */
  closeAsDone: boolean;
  reopenTalk: boolean;
}> {
  const approved = opts.decision === "approve";
  const reschedule = opts.decision === "reschedule";
  const request = await getRequest({
    tenantId: opts.tenantId,
    requestId: opts.meetingId,
  });
  if (!request) throw new Error("meeting_not_found");

  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { id: opts.tenantId },
  });
  const lastLead = await prisma.message.findFirst({
    where: { conversationId: request.conversationId, role: "lead" },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });

  const policy = isChatLanguage(tenant.chatLanguage) ? tenant.chatLanguage : "multi";
  const lang = resolveReplyLanguage(policy, lastLead?.text ?? "");
  const chat = copyFor(lang).chat;
  const data = visitData(request);
  const previousSlot = request.timeText;
  const config = parseBookingConfig(
    await loadInstanceConfig({
      tenantId: opts.tenantId,
      capabilityId: BOOKING_CAPABILITY,
    }),
  );
  const business = tenant.name?.trim() || chat.fallbackTeamName;
  const address = data.venue || config.venueAddress;
  const hours = data.hours || config.venueHours;

  const varsFor = (slotRaw: string, note?: string) =>
    meetingMessageVars({
      lang,
      slotRaw,
      address,
      hours,
      name: request.contactName,
      phone: request.contactPhone,
      email: request.contactEmail,
      need: data.need ?? "",
      kind: data.visit_kind ?? VISIT_KIND,
      business,
      note,
    });

  const vars = varsFor(previousSlot, opts.note);
  const altRaw = opts.alternativeSlot?.trim() ?? "";
  const altNormalized = altRaw ? normalizeSlot(altRaw, { lang }) : null;
  const altSlot = altNormalized?.display || altRaw;
  const { note: _noteVar, ...baseVars } = vars;
  const bookingOnly = { ...baseVars, alt_slot: altSlot };
  const approveVars = approved
    ? { ...varsFor(previousSlot), alt_slot: altSlot }
    : bookingOnly;

  const custom = opts.customReply?.trim();
  let text: string;
  if (custom && approved) {
    text = custom;
  } else if (approved) {
    text = renderBookingMessage(
      config.messageTemplates.approved,
      chat.bookingApprovedTemplate,
      approveVars,
    );
  } else if (reschedule && altSlot) {
    text = renderBookingMessage(undefined, chat.bookingReschedule, bookingOnly);
  } else {
    text = renderBookingMessage(
      config.messageTemplates.rejected,
      chat.bookingRejected,
      bookingOnly,
    );
  }
  text = appendStaffNote(text, opts.note, chat.notePrefix);

  await decideRequest({
    tenantId: opts.tenantId,
    request,
    actorUserId: opts.actorUserId,
    decision: opts.decision,
    note: opts.note,
    customReply: opts.customReply,
    customerConfirmed: opts.customerConfirmed,
    alternative:
      reschedule && altSlot
        ? { startAt: timeTextToStartAt(altSlot), timeText: altSlot }
        : undefined,
  });

  const lead = await prisma.lead.findFirstOrThrow({ where: { id: request.leadId } });
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: request.conversationId },
  });
  const crm = { ...((lead.fields as Record<string, unknown>) ?? {}) };
  const session = { ...((conversation.session as Record<string, unknown>) ?? {}) };
  const fields = { ...crm, ...session };
  const nextFields: Record<string, unknown> = { ...fields, booking_confirm: "" };
  delete nextFields.time_preference;
  // Prior visit lives in the Request row; clear the session pin so rebook creates a new HITL.
  delete nextFields.booking;
  // Keep need from the prior visit so rebook / reschedule does not re-ask.
  const priorNeed = data.need?.trim() || String(fields.need ?? "").trim();
  if (priorNeed) nextFields.need = priorNeed;
  if (reschedule && altSlot) {
    nextFields.staff_slot_offer = {
      meetingId: request.id,
      slot: altSlot,
      previousSlot,
    } satisfies StaffSlotOffer;
    nextFields.booking_flow = "active";
  } else {
    delete nextFields.staff_slot_offer;
    // Decline without alternate: keep booking collect active so they can pick a new slot.
    if (!approved) {
      nextFields.booking_flow = "active";
    }
  }
  await persistTurnFields(opts.tenantId, lead.id, request.conversationId, nextFields);

  if (approved) {
    return {
      conversationId: request.conversationId,
      leadId: request.leadId,
      text,
      closeAsDone: true,
      reopenTalk: false,
    };
  }

  await prisma.conversation.update({
    where: { id: request.conversationId },
    data: { status: "open", flowState: "talk" },
  });

  return {
    conversationId: request.conversationId,
    leadId: request.leadId,
    text,
    closeAsDone: false,
    reopenTalk: true,
  };
}

/** Update durable visit details (e.g. need) after staff/customer follow-up. */
export async function updateMeetingDetails(opts: {
  tenantId: string;
  meetingId: string;
  need?: string;
}): Promise<{ ok: true; needText: string } | { ok: false; error: string }> {
  const request = await getRequest({
    tenantId: opts.tenantId,
    requestId: opts.meetingId,
  });
  if (!request) return { ok: false, error: "not_found" };

  const needText = opts.need?.trim();
  if (!needText) return { ok: false, error: "need_required" };

  await updateRequestData({
    tenantId: opts.tenantId,
    requestId: request.id,
    patch: { need: needText },
  });

  const lead = await prisma.lead.findFirst({ where: { id: request.leadId } });
  if (lead) {
    const fields = { ...((lead.fields as Record<string, unknown>) ?? {}), need: needText };
    await prisma.lead.update({
      where: { id: lead.id },
      data: { fields: fields as Prisma.InputJsonValue },
    });
  }

  return { ok: true, needText };
}
