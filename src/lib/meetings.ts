import { prisma } from "@/lib/db";
import {
  appendStaffNote,
  bookingVars,
  copyFor,
  renderBookingMessage,
} from "@/lib/copy";
import { askBookingField, bookingFieldGaps } from "@/lib/flow/booking";
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

function venueFromTenant(ctx: TurnContext): { address: string; hours: string } {
  return {
    address: ctx.tenant?.venueAddress?.trim() ?? "",
    hours: ctx.tenant?.venueHours?.trim() ?? "",
  };
}

function replyLangFromCtx(ctx: TurnContext): "en" | "he" {
  const last = [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
  return resolveReplyLanguage(ctx.tenant?.chatLanguage, last);
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
    }),
    note: opts.note?.trim() ?? "",
  };
}

export async function requestTentativeMeeting(
  ctx: TurnContext,
): Promise<{ ok: boolean; reply: string }> {
  const lang = replyLangFromCtx(ctx);
  const fields = { ...ctx.lead.fields };
  const venue = venueFromTenant(ctx);
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
  const kind = String(fields.visit_kind ?? "visit");
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
    kind,
  });
  const requestText = () =>
    renderBookingMessage(
      ctx.tenant?.bookingRequestTemplate,
      copyFor(lang).chat.bookingRequestTemplate,
      vars,
    );

  const existing = await prisma.meeting.findFirst({
    where: { conversationId: ctx.conversation.id, status: "pending" },
  });
  if (existing) {
    return { ok: true, reply: requestText() };
  }

  const meeting = await prisma.meeting.create({
    data: {
      tenantId: ctx.tenantId,
      leadId: ctx.lead.id,
      conversationId: ctx.conversation.id,
      status: "pending",
      kind,
      slotText: normalized.display,
      contactName: name,
      contactEmail: email,
      contactPhone: phone,
      venueText: venue.address,
      hoursText: venue.hours,
      needText: need,
    },
  });

  const summary = await summarizeConversation(ctx.conversation.id);

  await prisma.hitlTask.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      leadId: ctx.lead.id,
      type: "booking_approval",
      reason: "booking_approval",
      payload: {
        meetingId: meeting.id,
        name,
        phone,
        email,
        need,
        slot: normalized.display,
        date: normalized.dateLabel,
        time: normalized.timeLabel || normalized.time || "",
        kind,
        details: vars.details,
        summary,
      },
      status: "open",
    },
  });

  const booking = {
    meetingId: meeting.id,
    status: "pending",
    when: normalized.display,
    kind,
  };
  const nextFields = {
    ...fields,
    time_preference: normalized.display,
    phone,
    booking,
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
  const meeting = await prisma.meeting.findFirstOrThrow({
    where: { id: opts.meetingId, tenantId: opts.tenantId },
    include: {
      tenant: true,
      conversation: {
        include: {
          messages: {
            where: { role: "lead" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  const policy = isChatLanguage(meeting.tenant.chatLanguage)
    ? meeting.tenant.chatLanguage
    : "multi";
  const lang = resolveReplyLanguage(policy, meeting.conversation.messages[0]?.text ?? "");
  const chat = copyFor(lang).chat;
  const previousSlot = meeting.slotText;
  const vars = meetingMessageVars({
    lang,
    slotRaw: previousSlot,
    address: meeting.venueText || meeting.tenant.venueAddress || "",
    hours: meeting.hoursText || meeting.tenant.venueHours || "",
    name: meeting.contactName || "",
    phone: meeting.contactPhone || "",
    email: meeting.contactEmail || "",
    need: meeting.needText || "",
    kind: meeting.kind,
    note: opts.note,
  });

  const altRaw = opts.alternativeSlot?.trim() ?? "";
  const altNormalized = altRaw ? normalizeSlot(altRaw, { lang }) : null;
  const altSlot = altNormalized?.display || altRaw;
  const { note: _noteVar, ...baseVars } = vars;
  const bookingOnly = { ...baseVars, alt_slot: altSlot };

  const approveSlotRaw =
    approved && (opts.customerConfirmed || !reschedule) ? meeting.slotText : previousSlot;
  const approveVars = approved
    ? {
        ...meetingMessageVars({
          lang,
          slotRaw: approveSlotRaw,
          address: meeting.venueText || meeting.tenant.venueAddress || "",
          hours: meeting.hoursText || meeting.tenant.venueHours || "",
          name: meeting.contactName || "",
          phone: meeting.contactPhone || "",
          email: meeting.contactEmail || "",
          need: meeting.needText || "",
          kind: meeting.kind,
        }),
        alt_slot: altSlot,
      }
    : bookingOnly;

  const custom = opts.customReply?.trim();
  let text: string;
  if (custom && approved) {
    text = custom;
  } else if (approved) {
    text = renderBookingMessage(
      meeting.tenant.bookingApprovedTemplate,
      chat.bookingApprovedTemplate,
      approveVars,
    );
  } else if (reschedule && altSlot) {
    text = renderBookingMessage(undefined, chat.bookingReschedule, bookingOnly);
  } else {
    text = renderBookingMessage(
      meeting.tenant.bookingRejectedTemplate,
      chat.bookingRejected,
      bookingOnly,
    );
  }
  text = appendStaffNote(text, opts.note, chat.notePrefix);

  const relatedTasks = await prisma.hitlTask.findMany({
    where: {
      tenantId: opts.tenantId,
      conversationId: meeting.conversationId,
      type: "booking_approval",
    },
  });
  const related = relatedTasks.filter((t) => {
    const payload = t.payload as { meetingId?: string };
    return payload.meetingId === meeting.id;
  });

  const now = new Date();
  const nextSlotText = reschedule && altSlot ? altSlot : vars.slot;
  // Reschedule keeps the meeting pending until the customer accepts the offered slot.
  const nextStatus = approved ? "approved" : reschedule ? "pending" : "rejected";

  await prisma.$transaction([
    prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: nextStatus,
        decidedBy: approved || !reschedule ? opts.actorUserId : meeting.decidedBy,
        decidedAt: approved || !reschedule ? now : meeting.decidedAt,
        slotText: nextSlotText,
      },
    }),
    ...related.map((t) => {
      const prevPayload = (t.payload as Record<string, unknown>) ?? {};
      if (reschedule) {
        return prisma.hitlTask.update({
          where: { id: t.id },
          data: {
            status: "open",
            completedBy: null,
            completedAt: null,
            resolution: {
              decision: "reschedule",
              awaitingCustomerConfirm: true,
              meetingId: meeting.id,
              previousSlot,
              alternativeSlot: altSlot,
              note: opts.note ?? "",
              updatedAt: now.toISOString(),
            },
            payload: {
              ...prevPayload,
              meetingId: meeting.id,
              slot: altSlot,
              awaitingCustomerConfirm: true,
              previousSlot,
            },
          },
        });
      }
      return prisma.hitlTask.update({
        where: { id: t.id },
        data: {
          status: "done",
          completedBy: opts.actorUserId,
          completedAt: t.completedAt ?? now,
          resolution: {
            approved,
            decision: opts.decision,
            meetingId: meeting.id,
            note: opts.note ?? "",
            customReply: opts.customReply ?? "",
            alternativeSlot: altSlot,
            customerConfirmed: Boolean(opts.customerConfirmed),
            updatedAt: now.toISOString(),
          },
        },
      });
    }),
  ]);

  const lead = await prisma.lead.findFirstOrThrow({ where: { id: meeting.leadId } });
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: meeting.conversationId },
  });
  const crm = { ...((lead.fields as Record<string, unknown>) ?? {}) };
  const session = { ...((conversation.session as Record<string, unknown>) ?? {}) };
  const fields = { ...crm, ...session };
  const nextFields: Record<string, unknown> = {
    ...fields,
    booking_confirm: "",
  };
  delete nextFields.time_preference;
  // Prior meeting lives in Meeting row; clear the session pin so rebook creates a new HITL.
  delete nextFields.booking;
  // Keep need from the prior visit so rebook / reschedule does not re-ask.
  const priorNeed = meeting.needText?.trim() || String(fields.need ?? "").trim();
  if (priorNeed) nextFields.need = priorNeed;
  if (reschedule && altSlot) {
    nextFields.staff_slot_offer = {
      meetingId: meeting.id,
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
  await persistTurnFields(opts.tenantId, lead.id, meeting.conversationId, nextFields);

  if (approved) {
    return {
      conversationId: meeting.conversationId,
      leadId: meeting.leadId,
      text,
      closeAsDone: true,
      reopenTalk: false,
    };
  }

  await prisma.conversation.update({
    where: { id: meeting.conversationId },
    data: { status: "open", flowState: "talk" },
  });

  return {
    conversationId: meeting.conversationId,
    leadId: meeting.leadId,
    text,
    closeAsDone: false,
    reopenTalk: true,
  };
}
