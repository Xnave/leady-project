import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  askBookingField,
  bookingFieldGaps,
  extractVenueFromKnowledge,
  extractVisitKind,
  meetingApprovedMessage,
  meetingRejectedMessage,
  tentativeBookingMessage,
} from "@/lib/flow/booking";
import { resolveReplyLanguage } from "@/lib/flow/locale";
import type { TurnContext } from "@/lib/flow/types";

export async function requestTentativeMeeting(
  ctx: TurnContext,
): Promise<{ ok: boolean; reply: string }> {
  const lang = resolveReplyLanguage(
    ctx.tenant?.chatLanguage,
    [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "",
  );
  const fields = { ...ctx.lead.fields };
  if (!fields.visit_kind) {
    const fromTalk = extractVisitKind(
      ctx.messages
        .filter((m) => m.role === "lead")
        .map((m) => m.text)
        .join("\n"),
    );
    if (fromTalk) fields.visit_kind = fromTalk;
  }
  const gaps = bookingFieldGaps(fields);
  if (gaps.length > 0) {
    return { ok: false, reply: askBookingField(lang, gaps[0]) };
  }

  const venue = extractVenueFromKnowledge(ctx.agent.knowledgeText);
  const slot = String(fields.time_preference);
  const kind = String(fields.visit_kind ?? "showroom");
  const name = String(fields.name ?? "");
  const email = String(fields.email ?? "");
  const phone = String(fields.phone ?? "");

    const existing = await prisma.meeting.findFirst({
      where: {
        conversationId: ctx.conversation.id,
        status: "pending",
      },
    });
    if (existing) {
      return {
        ok: true,
        reply: tentativeBookingMessage(lang, {
          slot: existing.slotText,
          address: existing.venueText || venue.address,
          kind: existing.kind,
        }),
      };
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
    },
  });

  await prisma.hitlTask.create({
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      leadId: ctx.lead.id,
      type: "booking_approval",
      reason: `${kind} · ${slot} · ${name}`,
      payload: { meetingId: meeting.id },
      status: "open",
    },
  });

  const booking = {
    meetingId: meeting.id,
    status: "pending",
    when: slot,
    kind,
  };
  await prisma.lead.update({
    where: { id: ctx.lead.id },
    data: {
      fields: { ...fields, booking, visit_kind: kind } as Prisma.InputJsonValue,
    },
  });
  ctx.lead.fields = { ...fields, booking, visit_kind: kind };

  return {
    ok: true,
    reply: tentativeBookingMessage(lang, {
      slot,
      address: venue.address,
      kind,
    }),
  };
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
  });
  const he =
    /[\u0590-\u05FF]/.test(meeting.slotText) ||
    /[\u0590-\u05FF]/.test(meeting.contactName);
  const replyLang: "en" | "he" = he ? "he" : "en";
  const text = opts.approved
    ? meetingApprovedMessage(replyLang, {
        slot: meeting.slotText,
        address: meeting.venueText,
        hours: meeting.hoursText,
        kind: meeting.kind,
      })
    : meetingRejectedMessage(replyLang);

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
