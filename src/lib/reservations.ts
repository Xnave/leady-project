import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { copyFor } from "@/lib/copy";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";
import { summarizeConversation } from "@/lib/flow/summarize";
import type { LeadFields, TurnContext } from "@/lib/flow/types";
import { persistTurnFields } from "@/lib/conversations";
import {
  parseReservationConfig,
  renderReservationTemplate,
  reservationEphemeralKeys,
  reservationTemplateVars,
  reservationVocab,
  type ReservationConfig,
} from "@/lib/flow/reservation-config";
import {
  reservationConfigFromCtx,
  reservationFieldGaps,
  stayDatesValid,
  clearReservationSessionFields,
} from "@/lib/flow/reservation-collect";
import { probeAvailabilityLink } from "@/lib/flow/availability-link-probe";
import { instanceKind } from "@/lib/flow/instances";
import { loadInstanceConfig } from "@/lib/capability-instances";
import { callbackPhone, savedPhone } from "@/lib/flow/booking-collect";
import {
  createRequestWithApprovalTask,
  decideRequest,
  findPendingRequest,
  getRequest,
  isoDateToUtc,
  utcToIsoDate,
  REQUEST_DECISION_CATEGORY,
} from "@/lib/requests";
import { AUTOMATIC_ACTOR } from "@/lib/decision-actor";
import { appendAdminDecision } from "@/lib/admin-decisions";

/** Capability that owns stay requests. */
export const RESERVATIONS_CAPABILITY = "reservations";
/** Instance kind for a stay. */
export const STAY_KIND = "stay";
/** Inbox history row after self-serve booking link was sent (no Request / no waiting_human). */
export const RESERVATION_LINK_SENT_TASK = "reservation_link_sent";

function replyLangFromCtx(ctx: TurnContext): "en" | "he" {
  const last = [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
  return resolveReplyLanguage(ctx.tenant?.chatLanguage, last);
}

async function configForTenant(tenantId: string): Promise<ReservationConfig> {
  return parseReservationConfig(
    await loadInstanceConfig({ tenantId, capabilityId: RESERVATIONS_CAPABILITY }),
  );
}

export async function checkStayAvailability(
  ctx: TurnContext,
): Promise<{ status: "available" | "unavailable" | "unknown"; url: string; replyHint: string }> {
  const config = reservationConfigFromCtx(ctx);
  const checkIn = String(ctx.lead.fields.check_in ?? "").trim();
  const checkOut = String(ctx.lead.fields.check_out ?? "").trim();
  const lang = replyLangFromCtx(ctx);
  const r = copyFor(lang).chat.request;

  if (!stayDatesValid(checkIn, checkOut)) {
    return { status: "unknown", url: "", replyHint: r.needValidDates };
  }

  const vars = reservationTemplateVars({
    checkIn,
    checkOut,
    unit: String(ctx.lead.fields.unit ?? ""),
    configVars: config.availability.linkProbe?.vars,
  });

  let url = "";
  if (config.bookingLinkTemplate) {
    url = renderReservationTemplate(config.bookingLinkTemplate, vars);
  }

  if (config.availability.kind !== "link_probe" || !config.availability.linkProbe) {
    return { status: "unknown", url, replyHint: r.availabilityNotConfigured };
  }

  const probed = await probeAvailabilityLink({
    config: config.availability.linkProbe,
    vars,
  });
  url = probed.url || url;

  if (probed.status === "unavailable") {
    return { status: "unavailable", url, replyHint: r.datesUnavailable(url) };
  }
  if (probed.status === "available") {
    return { status: "available", url, replyHint: r.datesAvailable };
  }

  const onUnknown = config.availability.onUnknown;
  if (onUnknown === "send_booking_link" && url) {
    return { status: "unknown", url, replyHint: r.availabilityUnknownLink(url) };
  }
  return { status: "unknown", url, replyHint: r.availabilityUnknownHitl };
}

export async function requestTentativeReservation(
  ctx: TurnContext,
): Promise<{ ok: boolean; reply: string }> {
  const lang = replyLangFromCtx(ctx);
  const config = reservationConfigFromCtx(ctx);
  const r = copyFor(lang).chat.request;
  const fields = { ...ctx.lead.fields };
  const gaps = reservationFieldGaps(fields, config);
  if (gaps.length > 0) {
    return { ok: false, reply: r.stillNeed(gaps.join(", ")) };
  }

  const checkIn = String(fields.check_in).trim();
  const checkOut = String(fields.check_out).trim();
  if (!stayDatesValid(checkIn, checkOut)) {
    return { ok: false, reply: r.invalidDates };
  }

  const phone = savedPhone(fields) || callbackPhone(ctx) || "";
  const name = String(fields.name ?? "").trim();
  const email = String(fields.email ?? "").trim();
  const guests = String(fields.guests ?? "").trim();
  const unit = String(fields.unit ?? "").trim();
  const noun = reservationVocab(config, lang).noun.singular;

  const detailKeys = config.collect.filter(
    (k) => k !== "name" && k !== "phone" && k !== "email",
  );
  const details: Record<string, string> = {};
  for (const key of detailKeys) {
    const v = String(fields[key] ?? "").trim();
    if (v) details[key] = v;
  }
  const detailsLine = Object.values(details).filter(Boolean).join(" · ");

  const vars = reservationTemplateVars({
    checkIn,
    checkOut,
    name,
    phone,
    email,
    guests,
    unit,
    business: ctx.tenant?.name?.trim() || copyFor(lang).chat.fallbackTeamName,
    details,
    configVars: config.availability.linkProbe?.vars,
    bookingUrl: String(fields.availability_url ?? ""),
  });

  const customTpl = config.messageTemplates?.request?.trim();
  const requestText = () =>
    customTpl
      ? renderReservationTemplate(customTpl, vars)
      : r.defaultRequest({ noun, from: checkIn, to: checkOut, details: detailsLine });

  const existing = await findPendingRequest({
    tenantId: ctx.tenantId,
    conversationId: ctx.conversation.id,
    capabilityId: RESERVATIONS_CAPABILITY,
  });
  if (existing) {
    return { ok: true, reply: requestText() };
  }

  const summary = await summarizeConversation(ctx.conversation.id);
  await createRequestWithApprovalTask({
    tenantId: ctx.tenantId,
    leadId: ctx.lead.id,
    conversationId: ctx.conversation.id,
    capabilityId: RESERVATIONS_CAPABILITY,
    kind: instanceKind(ctx, RESERVATIONS_CAPABILITY, STAY_KIND),
    // A stay is a span on the shared time spine.
    startAt: isoDateToUtc(checkIn),
    endAt: isoDateToUtc(checkOut),
    timeText: `${checkIn} → ${checkOut}`,
    contactName: name,
    contactEmail: email,
    contactPhone: phone,
    data: details,
    taskPayload: {
      checkIn,
      checkOut,
      guests,
      unit,
      details,
      summary,
    },
  });

  const nextFields: LeadFields = {
    ...fields,
    phone,
    reservation_confirm: "confirmed",
    reservation_flow: "active",
  };
  await persistTurnFields(ctx.tenantId, ctx.lead.id, ctx.conversation.id, nextFields, {
    extraSessionKeys: reservationEphemeralKeys(config),
  });
  ctx.lead.fields = nextFields;

  await prisma.conversation.update({
    where: { id: ctx.conversation.id },
    data: { status: "waiting_human", flowState: "waiting_human" },
  });
  ctx.conversation.status = "waiting_human";
  ctx.conversation.flowState = "waiting_human";

  return { ok: true, reply: requestText() };
}

/**
 * Self-serve finish: render the configured booking link and return it to the
 * customer. Does **not** create a Request or park on waiting_human.
 */
export async function sendReservationLink(
  ctx: TurnContext,
): Promise<{ ok: boolean; reply: string }> {
  const lang = replyLangFromCtx(ctx);
  const config = reservationConfigFromCtx(ctx);
  const r = copyFor(lang).chat.request;
  const fields = { ...ctx.lead.fields };
  const gaps = reservationFieldGaps(fields, config);
  if (gaps.length > 0) {
    return { ok: false, reply: r.stillNeed(gaps.join(", ")) };
  }

  const checkIn = String(fields.check_in).trim();
  const checkOut = String(fields.check_out).trim();
  if (!stayDatesValid(checkIn, checkOut)) {
    return { ok: false, reply: r.invalidDates };
  }

  const template = config.bookingLinkTemplate?.trim();
  if (!template) {
    return { ok: false, reply: r.availabilityNotConfigured };
  }

  const phone = savedPhone(fields) || callbackPhone(ctx) || "";
  const name = String(fields.name ?? "").trim();
  const email = String(fields.email ?? "").trim();
  const guests = String(fields.guests ?? "").trim();
  const unit = String(fields.unit ?? "").trim();
  const noun = reservationVocab(config, lang).noun.singular;

  const detailKeys = config.collect.filter(
    (k) => k !== "name" && k !== "phone" && k !== "email",
  );
  const details: Record<string, string> = {};
  for (const key of detailKeys) {
    const v = String(fields[key] ?? "").trim();
    if (v) details[key] = v;
  }

  const vars = reservationTemplateVars({
    checkIn,
    checkOut,
    name,
    phone,
    email,
    guests,
    unit,
    business: ctx.tenant?.name?.trim() || copyFor(lang).chat.fallbackTeamName,
    details,
    configVars: config.availability.linkProbe?.vars,
  });
  const bookingUrl = renderReservationTemplate(template, vars);
  if (!bookingUrl) {
    return { ok: false, reply: r.availabilityNotConfigured };
  }
  vars.bookingUrl = bookingUrl;

  const customTpl = config.messageTemplates?.sendLink?.trim();
  const reply = customTpl
    ? renderReservationTemplate(customTpl, vars)
    : r.sendBookingLink(noun, bookingUrl);

  // Clear ephemeral stay session so a follow-up "thanks" does not re-trigger collect.
  const cleared = clearReservationSessionFields(
    { ...fields, phone, name, email },
    config,
  );
  await persistTurnFields(ctx.tenantId, ctx.lead.id, ctx.conversation.id, cleared, {
    extraSessionKeys: reservationEphemeralKeys(config),
  });
  ctx.lead.fields = cleared;

  const now = new Date();
  const summary = await summarizeConversation(ctx.conversation.id);
  await prisma.$transaction([
    prisma.hitlTask.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversation.id,
        leadId: ctx.lead.id,
        type: RESERVATION_LINK_SENT_TASK,
        reason: RESERVATION_LINK_SENT_TASK,
        status: "done",
        completedBy: AUTOMATIC_ACTOR,
        completedAt: now,
        payload: {
          capabilityId: RESERVATIONS_CAPABILITY,
          kind: instanceKind(ctx, RESERVATIONS_CAPABILITY, STAY_KIND),
          linkSent: true,
          bookingUrl,
          checkIn,
          checkOut,
          guests,
          unit,
          name,
          phone,
          email,
          details,
          timeText: `${checkIn} → ${checkOut}`,
          summary,
        } as Prisma.InputJsonValue,
        resolution: {
          linkSent: true,
          decision: "link_sent",
        } as Prisma.InputJsonValue,
      },
    }),
    appendAdminDecision({
      tenantId: ctx.tenantId,
      leadId: ctx.lead.id,
      conversationId: ctx.conversation.id,
      category: REQUEST_DECISION_CATEGORY,
      action: "link_sent",
      actorUserId: AUTOMATIC_ACTOR,
      details: {
        capabilityId: RESERVATIONS_CAPABILITY,
        bookingUrl,
        checkIn,
        checkOut,
        timeText: `${checkIn} → ${checkOut}`,
      },
      createdAt: now,
    }),
  ]);

  return { ok: true, reply };
}

/**
 * Customer accepted the staff-offered alternative dates: move the row onto those
 * dates and record the approval. Keeps row writes out of the capability layer.
 */
export async function acceptOfferedReservationDates(opts: {
  tenantId: string;
  reservationId: string;
  checkIn: string;
  checkOut: string;
}): Promise<{ text: string }> {
  const { retimeRequest } = await import("@/lib/requests");
  await retimeRequest({
    tenantId: opts.tenantId,
    requestId: opts.reservationId,
    startAt: isoDateToUtc(opts.checkIn),
    endAt: isoDateToUtc(opts.checkOut),
    timeText: `${opts.checkIn} → ${opts.checkOut}`,
    status: "pending",
  });
  const result = await markReservationDecision({
    tenantId: opts.tenantId,
    reservationId: opts.reservationId,
    actorUserId: "customer",
    decision: "approve",
    customerConfirmed: true,
  });
  return { text: result.text };
}

export type ReservationDecision = "approve" | "decline" | "reschedule";

export type StaffDateOffer = {
  reservationId: string;
  checkIn: string;
  checkOut: string;
  previousCheckIn: string;
  previousCheckOut: string;
};

export function getStaffDateOffer(
  fields: Record<string, unknown> | null | undefined,
): StaffDateOffer | null {
  if (!fields) return null;
  const raw = fields.staff_date_offer;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (
    typeof rec.reservationId !== "string" ||
    typeof rec.checkIn !== "string" ||
    typeof rec.checkOut !== "string"
  ) {
    return null;
  }
  return {
    reservationId: rec.reservationId,
    checkIn: rec.checkIn,
    checkOut: rec.checkOut,
    previousCheckIn: typeof rec.previousCheckIn === "string" ? rec.previousCheckIn : "",
    previousCheckOut: typeof rec.previousCheckOut === "string" ? rec.previousCheckOut : "",
  };
}

export async function markReservationDecision(opts: {
  tenantId: string;
  reservationId: string;
  actorUserId: string;
  decision: ReservationDecision;
  note?: string;
  customReply?: string;
  alternativeCheckIn?: string;
  alternativeCheckOut?: string;
  customerConfirmed?: boolean;
}): Promise<{
  conversationId: string;
  leadId: string;
  text: string;
  closeAsDone: boolean;
  reopenTalk: boolean;
}> {
  const approved = opts.decision === "approve";
  const reschedule = opts.decision === "reschedule";
  const reservation = await getRequest({
    tenantId: opts.tenantId,
    requestId: opts.reservationId,
  });
  if (!reservation) throw new Error("reservation_not_found");

  const tenant = await prisma.tenant.findFirstOrThrow({
    where: { id: opts.tenantId },
  });
  const lastLead = await prisma.message.findFirst({
    where: { conversationId: reservation.conversationId, role: "lead" },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });

  const config = await configForTenant(opts.tenantId);
  const policy = isChatLanguage(tenant.chatLanguage) ? tenant.chatLanguage : "multi";
  const lang = resolveReplyLanguage(policy, lastLead?.text ?? "");
  const checkIn = reservation.startAt ? utcToIsoDate(reservation.startAt) : "";
  const checkOut = reservation.endAt ? utcToIsoDate(reservation.endAt) : "";
  const details = reservation.data as Record<string, string>;
  const vars = reservationTemplateVars({
    checkIn,
    checkOut,
    name: reservation.contactName,
    phone: reservation.contactPhone,
    email: reservation.contactEmail,
    guests: details.guests ?? "",
    unit: details.unit ?? "",
    business: tenant.name?.trim() || copyFor(lang).chat.fallbackTeamName,
    note: opts.note,
    details,
    configVars: config.availability.linkProbe?.vars,
  });

  const altIn = opts.alternativeCheckIn?.trim() ?? "";
  const altOut = opts.alternativeCheckOut?.trim() ?? "";
  const custom = opts.customReply?.trim();
  const r = copyFor(lang).chat.request;
  const noun = reservationVocab(config, lang).noun.singular;

  let text: string;
  if (custom && (approved || !reschedule)) {
    text = custom;
  } else if (approved) {
    const tpl = config.messageTemplates?.approved?.trim();
    text = tpl
      ? renderReservationTemplate(tpl, vars)
      : r.defaultApproved(noun, checkIn, checkOut);
    if (config.bookingLinkTemplate && !custom) {
      const link = renderReservationTemplate(config.bookingLinkTemplate, vars);
      if (link) text += `\n${r.completeBookingLink(link)}`;
    }
  } else if (reschedule && altIn && altOut) {
    text = r.offerAltDates(altIn, altOut);
    if (opts.note?.trim()) text += `\n${opts.note.trim()}`;
  } else {
    const tpl = config.messageTemplates?.rejected?.trim();
    text = tpl
      ? renderReservationTemplate(tpl, { ...vars, note: opts.note?.trim() ?? "" })
      : r.defaultRejected(noun, checkIn, checkOut, opts.note?.trim() ?? "");
  }

  await decideRequest({
    tenantId: opts.tenantId,
    request: reservation,
    actorUserId: opts.actorUserId,
    decision: opts.decision,
    note: opts.note,
    customReply: opts.customReply,
    customerConfirmed: opts.customerConfirmed,
    alternative:
      reschedule && altIn && altOut
        ? {
            startAt: isoDateToUtc(altIn),
            endAt: isoDateToUtc(altOut),
            timeText: `${altIn} \u2192 ${altOut}`,
          }
        : undefined,
  });

  if (reschedule && altIn && altOut) {
    const session = {
      ...((await prisma.conversation.findFirst({
        where: { id: reservation.conversationId },
        select: { session: true },
      }))?.session as LeadFields) ?? {},
      staff_date_offer: {
        reservationId: reservation.id,
        checkIn: altIn,
        checkOut: altOut,
        previousCheckIn: checkIn,
        previousCheckOut: checkOut,
      },
      reservation_confirm: "",
      check_in: altIn,
      check_out: altOut,
    };
    await prisma.conversation.update({
      where: { id: reservation.conversationId },
      data: {
        status: "open",
        flowState: "talk",
        session: session as Prisma.InputJsonValue,
      },
    });
    return {
      conversationId: reservation.conversationId,
      leadId: reservation.leadId,
      text,
      closeAsDone: false,
      reopenTalk: true,
    };
  }

  if (!approved) {
    const currentSession =
      ((await prisma.conversation.findFirst({
        where: { id: reservation.conversationId },
        select: { session: true },
      }))?.session as LeadFields) ?? {};
    await prisma.conversation.update({
      where: { id: reservation.conversationId },
      data: {
        status: "open",
        flowState: "talk",
        session: {
          ...currentSession,
          reservation_confirm: "",
          reservation_flow: "active",
          staff_date_offer: "",
        } as Prisma.InputJsonValue,
      },
    });
  }

  return {
    conversationId: reservation.conversationId,
    leadId: reservation.leadId,
    text,
    closeAsDone: approved,
    reopenTalk: !approved,
  };
}
