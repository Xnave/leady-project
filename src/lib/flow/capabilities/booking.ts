import { tool } from "ai";
import { z } from "zod";
import { copyFor, replyLang } from "@/lib/copy";
import {
  askBookingField,
  BOOKING_SESSION_FIELD_KEYS,
  bookingConfirmStatus,
  bookingFieldGaps,
  gateBookOnGaps,
  isBookingCollectActive,
} from "../booking";
import {
  callbackPhone,
  effectiveBookingRequired,
  looksLikeEmail,
  looksLikePhoneNumber,
  savedPhone,
} from "../booking-collect";
import { capabilityState, registerCapability, resolveTalkCapabilities } from "../registry";
import type { LeadFields, TalkOutcome, TalkStage, TurnContext } from "../types";
import {
  getStaffSlotOffer,
  loadRecentMeeting,
  markMeetingDecision,
  updateMeetingDetails,
  type RecentMeetingSnapshot,
} from "@/lib/meetings";
import { looksLikeShortAffirmation } from "../affirm";
import {
  gatheredInterest,
  interestFromTranscript,
  looksLikeNeedDeixis,
  looksLikeNothingToAdd,
  resolveNeedFromReply,
} from "../need-context";
import { normalizeSlot, proposesDifferentSlot } from "../slot";
import {
  bookingNoun,
  bookingConfigFromCtx,
  venueHoursFromCtx,
  venueScheduleFromCtx,
  venueTimezoneFromCtx,
} from "../booking-config";
import {
  evaluateTimePreference,
  timePreferenceNormalizeError,
} from "../time-preference-gate";
import {
  formatPhoneDisplay,
  isCustomerNameSatisfied,
  looksLikeIncompleteCustomerName,
} from "@/lib/leads";

/**
 * Ask the next booking gap. When asking need: seed interest from CRM or first
 * substantial lead message, then present it with an invite for extras.
 */
function askNextBookingGap(
  lang: "en" | "he",
  field: string,
  fields: LeadFields,
  extras: { hours?: string; deducedPhone?: string },
  opts?: { ctx?: TurnContext; collected?: TalkCollected },
): string {
  let bag = fields;
  if (field === "need" && opts?.collected) {
    let interest = gatheredInterest(bag);
    if (!interest && opts.ctx) {
      interest = interestFromTranscript(opts.ctx.messages);
      if (interest) {
        opts.collected.fields = { ...opts.collected.fields, interest };
        bag = { ...bag, interest };
      }
    }
  }
  return askBookingField(lang, field, {
    ...extras,
    gatheredNeed: field === "need" ? gatheredInterest(bag) : undefined,
  });
}

function markNeedPrompted(collected: TalkCollected, field: string): void {
  if (field === "need") {
    collected.fields = { ...collected.fields, need_prompted: "1" };
  }
}

/** Calendar date + clock for customer-facing confirm (never raw "מחר ב-17:00"). */
function displayTimePreference(
  raw: string,
  lang: "en" | "he",
  now?: Date,
): string {
  const text = raw.trim();
  if (!text) return "";
  const slot = normalizeSlot(text, { lang, now });
  if (slot.dateIso && slot.timeLabel) return slot.display;
  if (slot.dateLabel && slot.timeLabel && slot.display !== text) return slot.display;
  return text;
}

function buildBookingConfirmText(
  lang: "en" | "he",
  fields: LeadFields,
  phoneDisplay: string,
): string {
  const chat = copyFor(lang).chat;
  const name = String(fields.name ?? "").trim();
  const need = String(fields.need ?? "").trim();
  const slot = displayTimePreference(String(fields.time_preference ?? ""), lang);
  const email = String(fields.email ?? "").trim();
  const labelName = lang === "he" ? "שם" : "Name";
  const labelNeed = lang === "he" ? "פרטי הפגישה" : "Visit details";
  const labelWhen = lang === "he" ? "מועד" : "When";
  const labelPhone = lang === "he" ? "טלפון" : "Phone";
  const labelEmail = lang === "he" ? "אימייל" : "Email";
  const body: string[] = [chat.bookingConfirmIntro];
  if (name) body.push(`${labelName}: ${name}`);
  if (need) body.push(`${labelNeed}: ${need}`);
  if (slot) body.push(`${labelWhen}: ${slot}`);
  if (phoneDisplay) body.push(`${labelPhone}: ${phoneDisplay}`);
  if (email) body.push(`${labelEmail}: ${email}`);
  body.push("", chat.bookingConfirmAsk);
  return body.join("\n");
}

export type TalkCollected = TalkOutcome & {
  askFieldUsed?: boolean;
  replyLocked?: boolean;
  /** Set when time_preference was rejected this turn — do not overwrite with another ask. */
  timeRejected?: boolean;
};

function lastLeadText(ctx: TurnContext): string {
  return [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
}

/** The lead's still-relevant meeting, loaded by this capability's `loadState` hook. */
export function recentMeeting(ctx: TurnContext): RecentMeetingSnapshot | undefined {
  return capabilityState<RecentMeetingSnapshot>(ctx, "booking") ?? undefined;
}

/** Short customer affirmations after confirm_details. */
function looksLikeBookingAffirmation(text: string): boolean {
  return looksLikeShortAffirmation(text);
}

/**
 * Ensure a confirmed booking always goes through book_meeting (HITL), never a
 * free-text reply, and treat a short "yes" after confirm_details as confirmation.
 *
 * This used to live in the interpreter as `enforceBookingEffects`; it is registered
 * as this capability's `reconcile` hook so the kernel stays domain-free.
 */
export function reconcileBooking(
  ctx: TurnContext,
  stage: TalkStage,
  out: TalkOutcome,
): TalkOutcome {
  if (!resolveTalkCapabilities(stage).includes("booking")) return out;
  if (stage.allowBook === false) return out;
  const required = effectiveBookingRequired(ctx);
  const fields = { ...ctx.lead.fields, ...(out.fields ?? {}) };
  const offered = getStaffSlotOffer(fields);
  const active = isBookingCollectActive(fields, required) || Boolean(offered);

  let effects = [...(out.effects ?? [])];
  if (active) {
    effects = effects.filter((e) => e.type !== "start_new_conversation");
  }

  if (!isBookingCollectActive(fields, required)) {
    return active ? { ...out, effects } : out;
  }

  let confirm = bookingConfirmStatus(fields);
  const nextFields = { ...(out.fields ?? {}) };
  const last = lastLeadText(ctx);
  const affirmed = looksLikeBookingAffirmation(last);

  // After we presented gathered interest + asked for more: soft "no" / deixis → commit interest as need.
  {
    const interest = gatheredInterest({ ...fields, ...nextFields });
    const needEmpty = !String(fields.need ?? nextFields.need ?? "").trim();
    const prompted = String(fields.need_prompted ?? nextFields.need_prompted ?? "").trim() === "1";
    if (
      needEmpty &&
      prompted &&
      interest &&
      (looksLikeNothingToAdd(last) || looksLikeNeedDeixis(last))
    ) {
      nextFields.need = interest;
      nextFields.need_prompted = "";
    }
  }

  // Customer agreed to the summary — treat the listed name as verified so a
  // single-token name cannot block book_meeting / inbox HITL after "כן".
  if (confirm === "pending" && affirmed && String(fields.name ?? "").trim()) {
    nextFields.name_collected_by_agent = "1";
  }

  const gapsAfter = bookingFieldGaps({ ...fields, ...nextFields }, required);

  if (gapsAfter.length === 0 && confirm === "pending" && affirmed) {
    nextFields.booking_confirm = "confirmed";
    confirm = "confirmed";
  }

  let nextStage = out.nextStage;
  let reply = out.reply;

  if (
    gapsAfter.length === 0 &&
    confirm === "confirmed" &&
    !effects.some((e) => e.type === "book_meeting")
  ) {
    effects.push({ type: "book_meeting" });
  }

  // Affirmed while gaps remain: never keep a free-text "I saved your request".
  if (confirm === "pending" && affirmed && gapsAfter.length > 0) {
    reply = askNextBookingGap(
      replyLang(ctx, lastLeadText(ctx)),
      gapsAfter[0],
      { ...fields, ...nextFields },
      { hours: venueHoursFromCtx(ctx) },
      { ctx },
    );
  }

  // Never mark the talk goal complete while booking is still in progress.
  if (
    nextStage === stage.on_complete ||
    nextStage === "done" ||
    (typeof nextStage === "string" && nextStage.endsWith("done"))
  ) {
    nextStage = undefined;
  }

  return {
    ...out,
    reply,
    fields: Object.keys(nextFields).length ? { ...out.fields, ...nextFields } : out.fields,
    effects,
    nextStage,
    book: gapsAfter.length === 0 && confirm === "confirmed" ? true : out.book,
  };
}

function pushEffect(collected: TalkCollected, effect: NonNullable<TalkOutcome["effects"]>[number]) {
  collected.effects = [...(collected.effects ?? []), effect];
}

function lastStaffNoteQuestion(ctx: TurnContext, lang: "en" | "he"): string | undefined {
  const prefix = copyFor(lang).chat.notePrefix;
  for (let i = ctx.messages.length - 1; i >= 0; i -= 1) {
    const m = ctx.messages[i];
    if (m.role !== "agent" && m.role !== "human") continue;
    const idx = m.text.lastIndexOf(prefix);
    if (idx < 0) continue;
    const note = m.text.slice(idx + prefix.length).trim();
    if (note) return note;
  }
  return undefined;
}

/** Persist meeting details. Does not send WhatsApp — call reply in the same turn. */
function updateMeetingDetailsTool(ctx: TurnContext, collected: TalkCollected) {
  const meetingId = recentMeeting(ctx)?.id;
  return tool({
    description:
      "Save meeting details (פרטי הפגישה) when the customer gave concrete wording to store. Does NOT send WhatsApp text — always call reply in the SAME turn with a short message TO THE CUSTOMER (ack, or ask what to write if they only said it's wrong). Pass their words only; never invent a staff/CRM summary.",
    inputSchema: z.object({
      need: z
        .string()
        .describe("Customer's meeting-details wording to store"),
      meetingId: z.string().optional(),
    }),
    execute: async ({
      need,
      meetingId: explicitId,
    }: {
      need: string;
      meetingId?: string;
    }) => {
      const text = need.trim();
      if (!text) {
        return JSON.stringify({
          ok: false,
          error: "empty_need",
          hint: "Call reply to ask the customer what to write. Do not invent details.",
        });
      }
      const id = (explicitId || meetingId || "").trim();
      if (!id) {
        return JSON.stringify({ ok: false, error: "no_meeting" });
      }
      const result = await updateMeetingDetails({
        tenantId: ctx.tenantId,
        meetingId: id,
        need: text,
      });
      if (!result.ok) return JSON.stringify(result);
      collected.fields = { ...collected.fields, need: result.needText };
      return JSON.stringify({
        ok: true,
        need: result.needText,
        hint: "Call reply now with a brief customer-facing message.",
      });
    },
  });
}

/** Booking capability: tools + prompt lines for visit requests. */
export function registerBookingCapability(): void {
  registerCapability({
    id: "booking",
    sessionFieldKeys: BOOKING_SESSION_FIELD_KEYS,
    reconcile: ({ ctx, stage, outcome }) => reconcileBooking(ctx, stage, outcome),
    loadState: ({ tenantId, leadId }) => loadRecentMeeting(tenantId, leadId),
    decide: (input) =>
      markMeetingDecision({
        tenantId: input.tenantId,
        meetingId: input.requestId,
        actorUserId: input.actorUserId,
        decision: input.decision,
        note: input.note,
        customReply: input.customReply,
        alternativeSlot: input.alternativeStart,
        customerConfirmed: input.customerConfirmed,
      }),
    closingLines: () => [
      "Prefer reply for informational turns. Call ask_field only while booking is in progress.",
      "Call reply unless ask_field or resolve_offered_slot already set the outbound text. After update_meeting_details, still call reply in the same turn.",
      "Meeting details (פרטי הפגישה): concrete customer wording → update_meeting_details then reply; wrong/incomplete with no replacement → reply only and ask. Always write TO the customer, never staff/CRM notes.",
    ],
    promptSection: ({ ctx, fields }) => {
      const required = effectiveBookingRequired(ctx);
      const recent = recentMeeting(ctx);
      const lang = replyLang(ctx, lastLeadText(ctx));
      const noun = bookingNoun(bookingConfigFromCtx(ctx), "en").singular;
      const staffNote = lastStaffNoteQuestion(ctx, lang);
      const offered = getStaffSlotOffer(fields);

      if (offered) {
        return [
          `A teammate offered an alternative ${noun} slot and is waiting on the customer: "${offered.slot}" (previous was "${offered.previousSlot || "n/a"}").`,
          "Call resolve_offered_slot with your decision:",
          '- decision="accept" ONLY if they clearly agree to THAT exact offered slot with no other day or time named.',
          '- decision="decline" if they reject it or name any other slot (pass proposed_slot).',
          '- decision="unclear" if you cannot tell.',
          "Never treat a fresh booking request as accept of the staff offer.",
          "Do NOT call ask_field, book_meeting, or confirm_details while this offer is pending.",
        ];
      }

      const active = isBookingCollectActive(fields, required);
      if (active) {
        const gaps = bookingFieldGaps(fields, required);
        const confirm = bookingConfirmStatus(fields);
        const storedName = String(fields.name ?? "").trim();
        const lines = [
          `${noun} booking is in progress. Gaps: ${gaps.join(", ") || "none"}. booking_confirm=${confirm || "(none)"}.`,
          "When they answer a booking question, call save_fields with their wording first, then ask_field for the next gap only.",
          "time_preference: weekday + clock is enough — save when inside bookable hours (latest start is 30 minutes before closing, e.g. by 18:30 when hours end at 19). Bare morning clock without ערב/בוקר may be rejected as AM — ask them to clarify evening if needed.",
          "CRITICAL: After save_fields accepts a time_preference, do NOT re-confirm the slot — immediately ask_field for the next gap only.",
          "If outside bookable hours (including at/after closing), do not save and do not ask other fields until time is valid.",
          "need / פרטי הפגישה: ask_field presents any saved interest and invites extras. Never save pointer phrases (מה שכתבתי למעלה / as above) as need — save_fields resolves them. Soft 'no / nothing else' keeps the gathered interest as need.",
          "Before book_meeting: confirm_details ONCE (only when Gaps is none and booking_confirm is not already pending). Rails write the confirm text — do not invent a second summary. Then after they agree: save_fields booking_confirm=confirmed, then book_meeting.",
          "Never call confirm_details again while booking_confirm=pending — wait for yes/no.",
          `confirm_details labels: פרטי הפגישה / ${noun} details for need — never צורך or Need.`,
          `CRITICAL: Never tell the customer you recorded/submitted a ${noun} request unless you called book_meeting and it returned ok. A plain reply claiming that is a bug.`,
          `After a teammate declines a ${noun}, collect a new time_preference and call book_meeting again — do not invent a confirmation.`,
          "Do not transition to on_complete/done while booking is in progress.",
          `Never say the ${noun} is confirmed — book_meeting only stores a tentative request for a human.`,
          "When acknowledging a saved request, name the business from context only — never invent a company name from the customer's name.",
        ];
        const interest = gatheredInterest(fields);
        if (interest && gaps.includes("need")) {
          lines.push(`Gathered interest to present when asking need: "${interest}".`);
        }
        if (
          required.includes("name") &&
          storedName &&
          looksLikeIncompleteCustomerName(storedName) &&
          !isCustomerNameSatisfied(fields)
        ) {
          lines.push(
            `Stored name "${storedName}" looks like a nickname or partial name. Ask for their full name via ask_field name. Do not re-ask after they already gave a name in this chat (save_fields marks it collected).`,
          );
        }
        return lines;
      }

      if (recent && (recent.status === "approved" || recent.status === "pending")) {
        const lines = [
          `Upcoming/active meeting on this lead (id=${recent.id}): status=${recent.status}, slot="${recent.slotText}", need="${recent.needText || "(empty)"}", name="${recent.contactName || ""}".`,
          "Only treat this turn as a meeting follow-up when their message CLEARLY relates to that meeting (details, time, confirmation, answering a staff note about it).",
          "Bare hellos, or unrelated chat → normal reply. Do NOT mention the meeting, past need text, or ask how else to help with it.",
          "When they clearly give/correct meeting details for that meeting: update_meeting_details then reply in the SAME turn.",
          "If they say details are wrong but give no replacement, do NOT call update_meeting_details — only reply and ask what to write.",
          "Do NOT send a fresh business intro. Do NOT call start_booking unless they explicitly ask for a new/different meeting.",
        ];
        if (staffNote) {
          lines.push(
            `Latest staff note / question still in thread: "${staffNote}". Treat the customer's reply as answering it when relevant.`,
          );
        }
        return lines;
      }

      const interest = gatheredInterest(fields);
      const idle = [
        `${noun} booking is NOT started. Use reply to answer product/sales questions from knowledge.`,
        'Examples that must NOT trigger booking: "I want a WhatsApp agent", "how much is it", "tell me more", "I need something for Instagram".',
        `Only call start_booking if they explicitly ask to schedule a ${noun}/meeting/demo/call, or clearly accept an offer to book.`,
        "When they already shared concrete context (pain, business type, goals — e.g. a mini-app dump), call save_interest with their wording in the SAME turn as reply. Do not invent. Do not start booking for that alone.",
        "Past/expired meetings are irrelevant — do not mention them, do not say בהמשך לפגישה, and do not reuse their need text unless the customer explicitly brings that meeting up.",
      ];
      if (interest) {
        idle.push(`Saved interest on this lead: "${interest}". Pass it via start_booking interest when booking starts.`);
      }
      return idle;
    },
    tools: ({ ctx, stage, collected }) => {
      const lang = replyLang(ctx, lastLeadText(ctx));
      const hours = venueHoursFromCtx(ctx);
      const schedule = venueScheduleFromCtx(ctx);
      const timeZone = venueTimezoneFromCtx(ctx);
      const required = effectiveBookingRequired(ctx);
      const fieldsForTurn = { ...ctx.lead.fields, ...collected.fields };
      const offered = getStaffSlotOffer(fieldsForTurn);
      const last = lastLeadText(ctx);
      const active = isBookingCollectActive(fieldsForTurn, required);

      if (offered) {
        return {
          resolve_offered_slot: tool({
            description:
              "Decide whether the customer accepted the teammate's offered alternative visit slot. Never accept if they named a different day or time — use decline + proposed_slot. Soft hint: if their message parses to a different slot than the offer, prefer decline.",
            inputSchema: z.object({
              decision: z.enum(["accept", "decline", "unclear"]),
              reason: z.string().optional(),
              proposed_slot: z.string().optional(),
            }),
            execute: async ({
              decision,
              proposed_slot,
            }: {
              decision: "accept" | "decline" | "unclear";
              reason?: string;
              proposed_slot?: string;
            }) => {
              const hintDifferent = proposesDifferentSlot(last, offered.slot, { lang });
              const proposedText =
                proposed_slot?.trim() || (hintDifferent ? last.trim() : "");
              if (decision === "accept" && hintDifferent) {
                return JSON.stringify({
                  ok: false,
                  hint: "Customer message appears to propose a different slot than the offer. Use decision=decline with proposed_slot, or decision=unclear.",
                });
              }
              if (decision === "accept") {
                const result = await markMeetingDecision({
                  tenantId: ctx.tenantId,
                  meetingId: offered.meetingId,
                  actorUserId: "customer",
                  decision: "approve",
                  customerConfirmed: true,
                });
                collected.reply = result.text;
                collected.replyLocked = true;
                collected.fields = { ...collected.fields, staff_slot_offer: "" };
                collected.nextStage = stage.on_complete;
                pushEffect(collected, { type: "accept_offered_slot" });
                return JSON.stringify({ ok: true, decision: "accept" });
              }
              if (decision === "decline") {
                const nextFields: LeadFields = {
                  ...collected.fields,
                  staff_slot_offer: "",
                };
                if (proposedText) {
                  nextFields.time_preference = proposedText;
                  nextFields.booking_flow = "active";
                  collected.reply =
                    lang === "he"
                      ? `הבנתי, רשמתי מועד אחר: ${proposedText}. אעביר לנציג לאישור — זה מתאים?`
                      : `Got it — noted a different time: ${proposedText}. I'll send that to the team for approval — does that look right?`;
                } else {
                  collected.reply =
                    lang === "he"
                      ? "הבנתי. באיזה יום ושעה אחרים נוח לך?"
                      : "Got it. What other day and time works for you?";
                }
                collected.fields = nextFields;
                collected.askFieldUsed = true;
                collected.replyLocked = true;
                return JSON.stringify({
                  ok: true,
                  decision: "decline",
                  proposed_slot: proposedText || undefined,
                });
              }
              collected.reply =
                lang === "he"
                  ? `רק לוודא — האם המועד ${offered.slot} מתאים לך?`
                  : `Just to confirm — does ${offered.slot} work for you?`;
              collected.replyLocked = true;
              return JSON.stringify({ ok: true, decision: "unclear" });
            },
          }),
          update_meeting_details: updateMeetingDetailsTool(ctx, collected),
        };
      }

      if (!active) {
        return {
          save_interest: tool({
            description:
              "Save concrete context the customer already stated (pain, business type, goals, mini-app findings) for later meeting details. Pass their wording only — do not invent or summarize into staff jargon. Does NOT start booking and does NOT send WhatsApp — still call reply in the same turn.",
            inputSchema: z.object({
              interest: z
                .string()
                .describe("Customer's own wording about what matters for them / the visit"),
            }),
            execute: async ({ interest }: { interest: string }) => {
              const text = interest.trim();
              if (!text) {
                return JSON.stringify({ ok: false, error: "empty_interest" });
              }
              if (looksLikeNeedDeixis(text)) {
                return JSON.stringify({
                  ok: false,
                  error: "deixis",
                  hint: "Pass the concrete wording from their earlier message, not a pointer phrase.",
                });
              }
              collected.fields = { ...collected.fields, interest: text };
              return JSON.stringify({ ok: true, interest: text });
            },
          }),
          start_booking: tool({
            description:
              "Begin collecting visit/meeting details. Call ONLY when the customer explicitly asks to schedule a meeting, visit, demo, or call — or clearly accepts your offer to book one. Do NOT call for product interest alone (e.g. wanting a WhatsApp agent, asking how it works, pricing, features). Do NOT call when they are only clarifying details for an existing/approved meeting — use update_meeting_details + reply instead. Optional interest: pass concrete context they already gave (or reuse saved interest) so the later need ask can present it.",
            inputSchema: z.object({
              reason: z.string().optional(),
              interest: z
                .string()
                .optional()
                .describe(
                  "Concrete visit/context wording they already shared; stored as CRM interest, not yet as need",
                ),
            }),
            execute: async ({ interest }: { reason?: string; interest?: string }) => {
              const first = required[0] ?? "time_preference";
              const fromArg = interest?.trim() ?? "";
              const existing = gatheredInterest(fieldsForTurn);
              const seeded =
                fromArg && !looksLikeNeedDeixis(fromArg)
                  ? fromArg
                  : existing;
              collected.fields = {
                ...collected.fields,
                booking_flow: "active",
                ...(seeded ? { interest: seeded } : {}),
              };
              collected.askFieldUsed = true;
              collected.replyLocked = true;
              const merged = { ...fieldsForTurn, ...collected.fields };
              collected.reply = askNextBookingGap(
                lang,
                first,
                merged,
                {
                  hours,
                  deducedPhone: first === "phone" ? callbackPhone(ctx) : undefined,
                },
                { ctx, collected },
              );
              markNeedPrompted(collected, first);
              return JSON.stringify({
                ok: true,
                next_field: first,
                ...(seeded ? { interest: seeded } : {}),
              });
            },
          }),
          update_meeting_details: updateMeetingDetailsTool(ctx, collected),
        };
      }

      const fieldShape = Object.fromEntries(
        Object.keys(ctx.agent.leadSchema.fields)
          .filter((k) => k !== "intent" && k !== "name_collected_by_agent")
          .map((k) => [k, z.string().optional()]),
      );
      fieldShape.booking_confirm = z.string().optional();
      fieldShape.booking_flow = z.string().optional();

      return {
        update_meeting_details: updateMeetingDetailsTool(ctx, collected),
        save_fields: tool({
          description:
            "Save details they already gave in chat, in their original wording. Do not invent. Do not translate names. Do not copy the WhatsApp/profile display name into name. For phone, only save after they gave or confirmed a number. Pass empty string to clear a field. time_preference must be inside opening hours when a clock time is clear. For need: never pass pointer phrases — rails resolve deixis / soft 'nothing else' against saved interest.",
          inputSchema: z.object(fieldShape),
          execute: async (raw: Record<string, unknown>) => {
            const fields: LeadFields = {};
            for (const [key, value] of Object.entries(raw)) {
              if (typeof value !== "string") continue;
              if (!value.trim()) {
                fields[key] = "";
                continue;
              }
              if (
                key === "phone" &&
                !looksLikePhoneNumber(value) &&
                value !== callbackPhone(ctx)
              ) {
                return `invalid phone: ${value}`;
              }
              if (key === "time_preference" && (hours || schedule.length)) {
                const result = evaluateTimePreference(value, {
                  lang,
                  hoursLabel: hours,
                  schedule,
                  timeZone,
                });
                const failure = timePreferenceNormalizeError(result, lang, hours);
                if (failure) {
                  collected.askFieldUsed = true;
                  collected.replyLocked = true;
                  collected.timeRejected = true;
                  collected.reply = failure.reask ?? copyFor(lang).chat.askTime(hours);
                  return JSON.stringify({
                    ok: false,
                    error: failure.error,
                    hint: failure.hint,
                  });
                }
              }
              if (key === "email" && value.trim() && !looksLikeEmail(value)) {
                collected.askFieldUsed = true;
                collected.replyLocked = true;
                collected.timeRejected = false;
                collected.reply = copyFor(lang).chat.askEmail;
                return JSON.stringify({
                  ok: false,
                  error: "invalid_email",
                  hint: "Ask again for a complete email only. Do not ask name or other fields until email is valid.",
                });
              }
              if (key === "need") {
                const mergedForNeed = { ...fieldsForTurn, ...collected.fields, ...fields };
                const resolved = resolveNeedFromReply(value, gatheredInterest(mergedForNeed));
                if ("reject" in resolved) {
                  const gathered = gatheredInterest(mergedForNeed);
                  collected.askFieldUsed = true;
                  collected.replyLocked = true;
                  collected.reply = askNextBookingGap(
                    lang,
                    "need",
                    mergedForNeed,
                    { hours },
                    { ctx, collected },
                  );
                  markNeedPrompted(collected, "need");
                  return JSON.stringify({
                    ok: false,
                    error: resolved.reject,
                    hint: gathered
                      ? "Need was not saved. Re-ask with gathered interest; if they add nothing, save the gathered text as need."
                      : "Need was not saved — ask for concrete meeting details, not a pointer to earlier messages.",
                  });
                }
                fields.need = resolved.need;
                fields.need_prompted = "";
                continue;
              }
              if (key === "time_preference") {
                fields.time_preference = displayTimePreference(value, lang);
                continue;
              }
              fields[key] = value.trim();
              if (key === "name" && value.trim()) {
                fields.name_collected_by_agent = "1";
              }
            }
            collected.fields = { ...collected.fields, ...fields };
            // Accepted in-hours time → next gap immediately (no LLM "closing hour" confirm).
            if (
              typeof fields.time_preference === "string" &&
              fields.time_preference.trim() &&
              !collected.replyLocked
            ) {
              const merged = { ...fieldsForTurn, ...collected.fields };
              const gaps = bookingFieldGaps(merged, required);
              if (gaps.length > 0) {
                const next = gaps[0];
                collected.askFieldUsed = true;
                collected.replyLocked = true;
                collected.reply = askNextBookingGap(
                  lang,
                  next,
                  merged,
                  {
                    hours,
                    deducedPhone: next === "phone" ? callbackPhone(ctx) : undefined,
                  },
                  { ctx, collected },
                );
                markNeedPrompted(collected, next);
                return JSON.stringify({ ok: true, next_field: next });
              }
            }
            return "ok";
          },
        }),
        ask_field: tool({
          description:
            "Ask for the next missing booking field (always the first gap). Only fields in the required booking list. Sets outbound text to that ask. When asking need, presents saved interest and invites optional extras. Do not call after a failed time_preference save in the same turn.",
          inputSchema: z.object({
            field: z.enum([
              "time_preference",
              "name",
              "need",
              "phone",
              "email",
              "visit_kind",
            ]),
          }),
          execute: async ({ field }: { field: string }) => {
            if (!required.includes(field)) {
              return `skip: ${field} is not required for booking`;
            }
            if (collected.timeRejected || (collected.replyLocked && collected.askFieldUsed)) {
              return JSON.stringify({
                ok: false,
                skip: true,
                hint: "Outbound ask already set this turn — do not ask another field.",
              });
            }
            const merged = { ...fieldsForTurn, ...collected.fields };
            const gaps = bookingFieldGaps(merged, required);
            if (gaps.length === 0) {
              return JSON.stringify({ ok: false, skip: true, hint: "No booking gaps left." });
            }
            // Always ask the first gap so the model cannot skip time_preference.
            const next = gaps[0];
            collected.askFieldUsed = true;
            collected.replyLocked = true;
            collected.reply = askNextBookingGap(
              lang,
              next,
              merged,
              {
                hours,
                deducedPhone: next === "phone" ? callbackPhone(ctx) : undefined,
              },
              { ctx, collected },
            );
            markNeedPrompted(collected, next);
            const withInterest = { ...merged, ...collected.fields };
            return JSON.stringify({
              ok: true,
              asked: next,
              ...(next !== field ? { redirected_from: field } : {}),
              ...(next === "need" && gatheredInterest(withInterest)
                ? { presented_interest: true }
                : {}),
            });
          },
        }),
        confirm_details: tool({
          description:
            "Present the visit details for the customer to confirm before book_meeting. Only call when booking gaps are none and booking_confirm is not already pending. Rails write the confirm text (ignore inventing a duplicate summary). Then booking_confirm=pending until they agree.",
          inputSchema: z.object({
            text: z
              .string()
              .optional()
              .describe("Ignored — confirm text is built by the system"),
          }),
          execute: async () => {
            const merged = { ...fieldsForTurn, ...collected.fields };
            if (bookingConfirmStatus(merged) === "pending") {
              return JSON.stringify({
                ok: false,
                skip: true,
                hint: "Already awaiting yes — do not resend confirm_details.",
              });
            }
            const gaps = bookingFieldGaps(merged, required);
            if (gaps.length > 0) {
              const next = gaps[0];
              collected.askFieldUsed = true;
              collected.replyLocked = true;
              collected.reply = askNextBookingGap(
                lang,
                next,
                merged,
                {
                  hours,
                  deducedPhone: next === "phone" ? callbackPhone(ctx) : undefined,
                },
                { ctx, collected },
              );
              markNeedPrompted(collected, next);
              return JSON.stringify({
                ok: false,
                missing: gaps,
                hint: `Ask for ${next} before confirm_details.`,
              });
            }
            const phoneRaw = savedPhone(merged) || callbackPhone(ctx) || "";
            const displayPhone = formatPhoneDisplay(phoneRaw) || phoneRaw;
            const slotNormalized = displayTimePreference(
              String(merged.time_preference ?? ""),
              lang,
            );
            if (
              slotNormalized &&
              slotNormalized !== String(merged.time_preference ?? "").trim()
            ) {
              collected.fields = {
                ...collected.fields,
                time_preference: slotNormalized,
              };
            }
            const forConfirm = {
              ...merged,
              ...collected.fields,
              ...(slotNormalized ? { time_preference: slotNormalized } : {}),
            };
            collected.reply = buildBookingConfirmText(lang, forConfirm, displayPhone);
            collected.replyLocked = true;
            const name = String(merged.name ?? "").trim();
            collected.fields = {
              ...collected.fields,
              booking_confirm: "pending",
              ...(name ? { name_collected_by_agent: "1" } : {}),
            };
            return "ok";
          },
        }),
        book_meeting: tool({
          description:
            "Record a tentative visit after required fields are known AND booking_confirm=confirmed. Do not claim the visit is confirmed with the business.",
          inputSchema: z.object({ confirm: z.boolean() }),
          execute: async () => {
            if (stage.allowBook === false) {
              return JSON.stringify({ ok: false, error: "disabled" });
            }
            const merged = { ...fieldsForTurn, ...collected.fields };
            for (const [key, value] of Object.entries(collected.fields ?? {})) {
              if (value === "") delete merged[key];
            }
            const gaps = bookingFieldGaps(merged, required);
            const gated = gateBookOnGaps({ book: true, gaps });
            if (!gated.book) {
              return JSON.stringify({ ok: false, missing: gaps });
            }
            if (bookingConfirmStatus(merged) !== "confirmed") {
              return JSON.stringify({
                ok: false,
                missing: ["booking_confirm"],
                hint: "Call confirm_details, then save_fields booking_confirm=confirmed after they agree.",
              });
            }
            pushEffect(collected, { type: "book_meeting" });
            return JSON.stringify({ ok: true });
          },
        }),
      };
    },
  });
}

