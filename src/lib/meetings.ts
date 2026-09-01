import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bookingVars, copyFor, renderBookingMessage } from "@/lib/copy";
import { askBookingField, bookingFieldGaps } from "@/lib/flow/booking";
import { bookingRequiredFields, callbackPhone, withKnownPhone } from "@/lib/flow/booking-collect";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";
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

export async function requestTentativeMeeting(
  ctx: TurnContext,
): Promise<{ ok: boolean; reply: string }> {
  const lang = replyLangFromCtx(ctx);
  const fields = withKnownPhone(ctx, { ...ctx.lead.fields });
  const venue = venueFromTenant(ctx);
  const gaps = bookingFieldGaps(fields, bookingRequiredFields(ctx));
  if (gaps.length > 0) {
    return { ok: false, reply: askBookingField(lang, gaps[0], { hours: venue.hours }) };
  }
  const slot = String(fields.time_preference);
  const kind = String(fields.visit_kind ?? "visit");
  const name = String(fields.name ?? "");
  const email = String(fields.email ?? "");
  const phone = String(fields.phone ?? callbackPhone(ctx) ?? "");
  const need = String(fields.need ?? "");
  const vars = bookingVars({
    slot,
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
      slotText: slot,
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
      reason: `${kind} · ${slot} · ${name}${need ? ` · ${need}` : ""}`,
      payload: { meetingId: meeting.id, name, phone, email, need, slot, kind },
      status: "open",
    },
  });

  const booking = { meetingId: meeting.id, status: "pending", when: slot, kind };
  await prisma.lead.update({
    where: { id: ctx.lead.id },
    data: {
      fields: { ...fields, booking, need } as Prisma.InputJsonValue,
    },
  });
  ctx.lead.fields = { ...fields, booking, need };

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
  const vars = bookingVars({
    slot: meeting.slotText,
    address: meeting.venueText || meeting.tenant.venueAddress,
    hours: meeting.hoursText || meeting.tenant.venueHours,
    name: meeting.contactName,
    phone: meeting.contactPhone,
    email: meeting.contactEmail,
    need: meeting.needText,
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
