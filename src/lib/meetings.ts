import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bookingVars, copyFor, renderBookingMessage } from "@/lib/copy";
import { askBookingField, bookingFieldGaps } from "@/lib/flow/booking";
import {
  bookingRequiredFields,
  callbackPhone,
  savedPhone,
} from "@/lib/flow/booking-collect";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";
import { normalizeSlot } from "@/lib/flow/slot";
import type { TurnContext } from "@/lib/flow/types";

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
}) {
  const normalized = normalizeSlot(opts.slotRaw, { lang: opts.lang });
  return bookingVars({
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
  });
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

  await prisma.hitlTask.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      leadId: ctx.lead.id,
      type: "booking_approval",
      reason: `${kind} · ${normalized.display} · ${name}${need ? ` · ${need}` : ""}`,
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
  await prisma.lead.update({
    where: { id: ctx.lead.id },
    data: {
      fields: {
        ...fields,
        time_preference: normalized.display,
        phone,
        booking,
        need,
      } as Prisma.InputJsonValue,
    },
  });
  ctx.lead.fields = { ...fields, time_preference: normalized.display, phone, booking, need };

  return { ok: true, reply: requestText() };
}

export async function markMeetingDecision(opts: {
  tenantId: string;
  meetingId: string;
  actorUserId: string;
  approved: boolean;
}): Promise<{
  conversationId: string;
  text: string;
  reopenTalk: boolean;
}> {
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
  const vars = meetingMessageVars({
    lang,
    slotRaw: meeting.slotText,
    address: meeting.venueText || meeting.tenant.venueAddress || "",
    hours: meeting.hoursText || meeting.tenant.venueHours || "",
    name: meeting.contactName || "",
    phone: meeting.contactPhone || "",
    email: meeting.contactEmail || "",
    need: meeting.needText || "",
    kind: meeting.kind,
  });
  const text = opts.approved
    ? renderBookingMessage(
        meeting.tenant.bookingApprovedTemplate,
        chat.bookingApprovedTemplate,
        vars,
      )
    : renderBookingMessage(
        meeting.tenant.bookingRejectedTemplate,
        chat.bookingRejected,
        vars,
      );

  if (meeting.status !== "pending") {
    return { conversationId: meeting.conversationId, text, reopenTalk: false };
  }

  const openTasks = await prisma.hitlTask.findMany({
    where: {
      tenantId: opts.tenantId,
      conversationId: meeting.conversationId,
      status: "open",
      type: "booking_approval",
    },
  });
  const related = openTasks.filter((t) => {
    const payload = t.payload as { meetingId?: string };
    return payload.meetingId === meeting.id;
  });

  await prisma.$transaction([
    prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: opts.approved ? "approved" : "rejected",
        decidedBy: opts.actorUserId,
        decidedAt: new Date(),
        slotText: vars.slot,
      },
    }),
    ...related.map((t) =>
      prisma.hitlTask.update({
        where: { id: t.id },
        data: {
          status: "done",
          completedBy: opts.actorUserId,
          completedAt: new Date(),
          resolution: { approved: opts.approved, meetingId: meeting.id },
        },
      }),
    ),
  ]);

  const lead = await prisma.lead.findFirstOrThrow({ where: { id: meeting.leadId } });
  const fields = (lead.fields as Record<string, unknown>) ?? {};
  const booking = fields.booking;
  if (booking && typeof booking === "object") {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        fields: {
          ...fields,
          booking: { ...booking, status: opts.approved ? "approved" : "rejected" },
        } as Prisma.InputJsonValue,
      },
    });
  }

  return {
    conversationId: meeting.conversationId,
    text,
    reopenTalk: !opts.approved,
  };
}
