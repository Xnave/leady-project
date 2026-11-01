import { tool } from "ai";
import { z } from "zod";
import { registerCapability } from "../registry";
import type { LeadFields, TalkOutcome, TalkStage, TurnContext } from "../types";
import { copyFor, replyLang } from "@/lib/copy";
import { looksLikeShortAffirmation } from "../affirm";
import { todayIsoDate, zonedToday } from "../clock";
import { resolveCalendarDateRange } from "../slot";
import {
  RESERVATION_SESSION_FIELD_KEYS,
  reservationCollectFields,
  reservationEphemeralKeys,
  reservationVocab,
  type ReservationConfig,
} from "../reservation-config";
import {
  isReservationCollectActive,
  reservationConfigFromCtx,
  reservationConfirmStatus,
  reservationFieldGaps,
  stayDatesValid,
} from "../reservation-collect";
import { reservationFieldContext, reservationFieldSpecs } from "../reservation-fields";
import { askField, confirmLines, normalizeFields } from "../fields";
import {
  acceptOfferedReservationDates,
  checkStayAvailability,
  getStaffDateOffer,
  markReservationDecision,
  movePendingReservationDates,
} from "@/lib/reservations";
import { persistTurnFields } from "@/lib/conversations";

function lastLeadText(ctx: TurnContext): string {
  return [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
}

/** A spoken stay that is not the staff offer. Same dates, or no range, return null. */
export function spokenReplacementStay(
  text: string,
  offer: { checkIn: string; checkOut: string },
  now: Date,
  lang: "en" | "he",
): { checkIn: string; checkOut: string } | null {
  const range = resolveCalendarDateRange(text, now, lang);
  if (!range || (range.start === offer.checkIn && range.end === offer.checkOut)) return null;
  return { checkIn: range.start, checkOut: range.end };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPastIsoDate(iso: string, todayIso: string): boolean {
  return ISO_DATE.test(iso) && iso < todayIso;
}

/** Prefer dates the customer actually said when the model stored a stale calendar. */
function applySpokenStayDates(
  collectable: Record<string, string>,
  spoken: string,
  now: Date,
  lang: "en" | "he",
): void {
  const range =
    resolveCalendarDateRange(spoken, now, lang) ||
    resolveCalendarDateRange(collectable.check_in ?? "", now, lang);
  if (!range) return;
  const today = todayIsoDate(now);
  const start = collectable.check_in?.trim() ?? "";
  const end = collectable.check_out?.trim() ?? "";
  const pair =
    ISO_DATE.test(start) &&
    ISO_DATE.test(end) &&
    !isPastIsoDate(start, today) &&
    !isPastIsoDate(end, today) &&
    start < end;
  if (pair) return;
  collectable.check_in = range.start;
  collectable.check_out = range.end;
}

function dropNewConversation(effects: NonNullable<TalkOutcome["effects"]>) {
  return effects.filter((e) => e.type !== "start_new_conversation");
}

/**
 * Submit the HITL hold as soon as collection is complete. Do not wait for a
 * spare "OK", and never rotate the thread while a stay request is in flight.
 */
export function reconcileReservations(
  ctx: TurnContext,
  stage: TalkStage,
  out: TalkOutcome,
): TalkOutcome {
  if (!resolveReservationsEnabled(stage)) return out;
  const config = reservationConfigFromCtx(ctx);
  const fields = { ...ctx.lead.fields, ...(out.fields ?? {}) };
  const offered = getStaffDateOffer(fields);
  const active = isReservationCollectActive(fields) || Boolean(offered);
  let effects = [...(out.effects ?? [])];
  if (active) effects = dropNewConversation(effects);

  if (offered) {
    return { ...out, effects };
  }
  if (effects.some((effect) => effect.type === "accept_offered_slot")) {
    return {
      ...out,
      effects,
      fields: { ...(out.fields ?? {}), reservation_flow: "" },
    };
  }
  if (!isReservationCollectActive(fields)) {
    return { ...out, effects };
  }

  const nextFields = { ...(out.fields ?? {}) };
  const merged = { ...fields, ...nextFields };
  const gapsBefore = reservationFieldGaps(ctx.lead.fields, config);
  const gapsAfter = reservationFieldGaps(merged, config);
  const datesUpdated = Boolean(
    String(nextFields.check_in ?? "").trim() || String(nextFields.check_out ?? "").trim(),
  );
  const confirm = reservationConfirmStatus(merged);
  const affirmed = looksLikeShortAffirmation(lastLeadText(ctx));
  const checkIn = String(merged.check_in ?? "").trim();
  const checkOut = String(merged.check_out ?? "").trim();
  const datesOk = stayDatesValid(checkIn, checkOut);
  const linkMode = config.submitMode === "send_link";
  const submitEffect = linkMode ? "send_reservation_link" : "create_reservation_hold";
  const submitAlready = effects.some(
    (e) => e.type === "create_reservation_hold" || e.type === "send_reservation_link",
  );
  const alreadySentLink = confirm === "sent_link";

  const completedThisTurn = gapsAfter.length === 0 && gapsBefore.length > 0;
  const confirmed =
    confirm === "confirmed" || (confirm === "pending" && affirmed);
  const shouldSubmit =
    gapsAfter.length === 0 &&
    datesOk &&
    !submitAlready &&
    !alreadySentLink &&
    (completedThisTurn || datesUpdated || confirmed);

  if (shouldSubmit) {
    nextFields.reservation_confirm = linkMode ? "sent_link" : "confirmed";
    effects.push({ type: submitEffect });
  }

  let nextStage = out.nextStage;
  if (
    nextStage === stage.on_complete ||
    nextStage === "done" ||
    (typeof nextStage === "string" && nextStage.endsWith("done"))
  ) {
    nextStage = undefined;
  }

  return {
    ...out,
    fields: Object.keys(nextFields).length ? { ...out.fields, ...nextFields } : out.fields,
    effects,
    nextStage,
  };
}

function pushEffect(
  collected: TalkOutcome & { askFieldUsed?: boolean; replyLocked?: boolean },
  effect: { type: string; args?: Record<string, unknown> },
) {
  collected.effects = [...(collected.effects ?? []), effect];
}

function pushReply(
  collected: TalkOutcome & { replyLocked?: boolean },
  text: string,
) {
  if (!collected.replyLocked) {
    collected.reply = text;
  }
}

/**
 * `reservation_confirm` is capability state, not a collected field, so it bypasses
 * the field kit (which only knows about the tenant's collect list).
 */
function splitReservationConfirm(raw: Record<string, string>): {
  confirm: LeadFields;
  collectable: Record<string, string>;
} {
  const { reservation_confirm, ...collectable } = raw;
  return {
    confirm:
      reservation_confirm === undefined
        ? {}
        : { reservation_confirm: reservation_confirm.trim() },
    collectable,
  };
}

/**
 * Same save as `save_fields`: tool fields, then the range in the latest lead
 * message, then the field kit. Older messages are not read.
 */
function saveStayFields(opts: {
  raw: Record<string, string>;
  spoken: string;
  lang: "en" | "he";
  specs: ReturnType<typeof reservationFieldSpecs>;
  fctx: ReturnType<typeof reservationFieldContext>;
  collected: TalkOutcome;
}): string[] {
  const { confirm, collectable } = splitReservationConfirm(opts.raw);
  const now = opts.fctx.now ?? zonedToday();
  applySpokenStayDates(collectable, opts.spoken, now, opts.lang);
  const { values } = normalizeFields(opts.specs, collectable, opts.fctx);
  opts.collected.fields = {
    ...(opts.collected.fields ?? {}),
    ...values,
    ...confirm,
  };
  return Object.keys(values);
}

function askReservationField(
  lang: "en" | "he",
  fieldId: string,
  config: ReservationConfig,
): string {
  const specs = reservationFieldSpecs(config);
  const fctx = reservationFieldContext(config, lang);
  return (
    askField(specs, fieldId, fctx) ??
    copyFor(lang).chat.request.askField(fieldId.replaceAll("_", " "))
  );
}

/** Ask the first missing field and keep that question. A later field is not asked yet. */
function lockNextStayQuestion(
  collected: TalkOutcome & { askFieldUsed?: boolean; replyLocked?: boolean },
  fields: LeadFields,
  config: ReservationConfig,
  lang: "en" | "he",
): string | null {
  const first = reservationFieldGaps(fields, config)[0];
  if (!first) return null;
  collected.reply = askReservationField(lang, first, config);
  collected.replyLocked = true;
  collected.askFieldUsed = true;
  return first;
}

function hasRates(config: ReservationConfig): boolean {
  return config.rates !== undefined && config.rates !== null;
}

function policyLines(config: ReservationConfig): string[] {
  if (!config.policies?.length) return [];
  return [
    "Configured hard policies (enforce; do not negotiate away):",
    ...config.policies.map(
      (p) => `- If customer intent matches "${p.trigger}": reply with exactly this policy: ${p.reply}`,
    ),
  ];
}

/** Stay reservations capability - behavior driven by its CapabilityInstance config. */
export function registerReservationsCapability(): void {
  registerCapability({
    id: "reservations",
    sessionFieldKeys: RESERVATION_SESSION_FIELD_KEYS,
    // The tenant's configured collect list is ephemeral too, so it varies per tenant.
    dynamicSessionKeys: (ctx) => reservationEphemeralKeys(reservationConfigFromCtx(ctx)),
    reconcile: ({ ctx, stage, outcome }) => reconcileReservations(ctx, stage, outcome),
    decide: (input) =>
      markReservationDecision({
        tenantId: input.tenantId,
        reservationId: input.requestId,
        actorUserId: input.actorUserId,
        decision: input.decision,
        note: input.note,
        customReply: input.customReply,
        alternativeCheckIn: input.alternativeStart,
        alternativeCheckOut: input.alternativeEnd,
        customerConfirmed: input.customerConfirmed,
      }),
    closingLines: () => [
      "Prefer reply for informational turns. Call ask_field only while a date-span request is in progress.",
      "Never say a request is confirmed or booked - create_reservation_hold only stores a tentative request for a human; send_reservation_link only shares a self-serve URL.",
      "Call reply unless ask_field already set the outbound text.",
    ],
    promptSection: ({ ctx, fields }) => {
      const config = reservationConfigFromCtx(ctx);
      const noun = reservationVocab(config, "en").noun.singular;
      const offered = getStaffDateOffer(fields);
      const collectList = reservationCollectFields(config).join(", ");
      const linkMode = config.submitMode === "send_link";

      if (offered) {
        const known = reservationCollectFields(config)
          .filter((k) => String(fields[k] ?? "").trim())
          .join(", ");
        return [
          `A teammate offered alternative ${noun} dates: ${offered.checkIn} → ${offered.checkOut} (was ${offered.previousCheckIn} → ${offered.previousCheckOut}).`,
          known ? `Already known (do not re-ask): ${known}.` : "",
          "Call resolve_offered_dates with your decision:",
          '- decision="accept" ONLY if they clearly agree to THOSE exact offered dates.',
          '- decision="decline" if they reject them or name any other dates. A different range in that message is stored on the pending request — do not ask which dates again.',
          '- decision="unclear" if you cannot tell.',
          "Do NOT call ask_field, confirm_details, start_reservation, create_reservation_hold, or send_reservation_link while this offer is pending.",
          "Do NOT call start_new_conversation.",
        ].filter(Boolean);
      }

      const active = isReservationCollectActive(fields);
      if (active) {
        const gaps = reservationFieldGaps(fields, config);
        const confirm = reservationConfirmStatus(fields);
        const finishTool = linkMode ? "send_reservation_link" : "create_reservation_hold";
        const lines = [
          `${noun} request is in progress. Collect fields: ${collectList}. Gaps: ${gaps.join(", ") || "none"}. reservation_confirm=${confirm || "(none)"}.`,
          "Save dates as YYYY-MM-DD (check_in / check_out). check_out must be after check_in.",
          "Ask only the first gap. Do not ask for a later field, such as the unit, while name or phone is still missing.",
          linkMode
            ? "Do not call check_availability - this tenant finishes by sending a booking link."
            : "After dates are saved, call check_availability before finishing the hold when possible.",
          `When Gaps is none, call ${finishTool} in the SAME turn - do not wait for the customer to say OK. confirm_details is optional.`,
          linkMode
            ? `CRITICAL: Never tell the customer you booked a ${noun}. Call send_reservation_link so they complete it on the website. Never claim the ${noun} is confirmed.`
            : `CRITICAL: Never tell the customer you submitted a ${noun} request unless create_reservation_hold returned ok.\nNever say the ${noun} is confirmed - only a human can approve.`,
          ...policyLines(config),
        ];
        if (!hasRates(config)) {
          lines.push(
            "No rate table is configured - do NOT invent prices. Answer amenity/policy questions from knowledge, or escalate discount/price asks to a human / send the booking link if configured.",
          );
        } else {
          lines.push(
            "A rate table is configured - only state prices that clearly follow it; otherwise say a teammate will confirm the total.",
          );
        }
        if (config.bookingLinkTemplate && !linkMode) {
          lines.push(
            "A bookingLinkTemplate is configured - you may share the filled link after availability check or when the customer wants to self-serve.",
          );
        }
        return lines;
      }

      return [
        `${noun} request is NOT started. Answer questions from knowledge with reply.`,
        `Only call start_reservation when they clearly want to book a ${noun} / check dates (not a sales meeting).`,
        `On that call, pass every detail already in their message (dates, guests, name, phone, unit). Do not invent any.`,
        `When collecting, fields are: ${collectList}.`,
        "Do not invent prices unless a rate table is configured on this tenant.",
        ...policyLines(config),
        linkMode
          ? "When collection finishes the agent sends a self-serve booking link - never claim the reservation is confirmed."
          : "Price questions without a configured rate table → do not invent amounts; offer availability check / human / booking link.",
      ];
    },
    tools: ({ ctx, stage, collected }) => {
      if (!resolveReservationsEnabled(stage)) return {};
      const lang = replyLang(ctx, lastLeadText(ctx));
      const config = reservationConfigFromCtx(ctx);
      const r = copyFor(lang).chat.request;
      const noun = reservationVocab(config, lang).noun.singular;
      const specs = reservationFieldSpecs(config);
      const fctx = reservationFieldContext(config, lang);
      const fieldsForTurn = { ...ctx.lead.fields, ...collected.fields };
      const active = isReservationCollectActive(fieldsForTurn);
      const offered = getStaffDateOffer(fieldsForTurn);
      const linkMode = config.submitMode === "send_link";

      const tools: Record<string, unknown> = {};

      if (!active && !offered) {
        tools.start_reservation = tool({
          description:
            `Start collecting a ${noun} request. Pass every detail already in the customer's message. Do not invent dates, names, or counts they did not say. A spoken date range is stored even when fields is empty.`,
          inputSchema: z.object({
            fields: z
              .record(z.string(), z.string())
              .optional()
              .describe(
                "Details already in this message: check_in, check_out, guests, name, phone, unit, or any other collected field.",
              ),
          }),
          execute: async ({ fields }: { fields?: Record<string, string> }) => {
            const saved = saveStayFields({
              raw: fields ?? {},
              spoken: lastLeadText(ctx),
              lang,
              specs,
              fctx,
              collected,
            });
            collected.fields = {
              ...(collected.fields ?? {}),
              reservation_flow: "active",
              reservation_confirm: String(collected.fields?.reservation_confirm ?? ""),
            };
            const first = lockNextStayQuestion(
              collected,
              { ...ctx.lead.fields, ...collected.fields },
              config,
              lang,
            );
            if (!first) return { ok: true, saved, active: true };
            return { ok: true, next_field: first, saved };
          },
        });
        return tools;
      }

      if (offered) {
        tools.resolve_offered_dates = tool({
          description:
            `Accept or decline staff-offered alternative ${noun} dates. Decline when they reject the offer or name any other dates. Do not ask for fields already known.`,
          inputSchema: z.object({
            decision: z.enum(["accept", "decline", "unclear"]),
          }),
          execute: async ({ decision }) => {
            const offer = getStaffDateOffer(fieldsForTurn);
            if (!offer) return { ok: false, error: "no_offer" };
            if (decision === "accept") {
              collected.fields = {
                ...(collected.fields ?? {}),
                check_in: offer.checkIn,
                check_out: offer.checkOut,
                reservation_confirm: "confirmed",
                reservation_flow: "",
                staff_date_offer: "",
              };
              ctx.lead.fields = { ...ctx.lead.fields, ...collected.fields };
              const result = await acceptOfferedReservationDates({
                tenantId: ctx.tenantId,
                reservationId: offer.reservationId,
                checkIn: offer.checkIn,
                checkOut: offer.checkOut,
              });
              pushReply(collected, result.text);
              collected.replyLocked = true;
              pushEffect(collected, { type: "accept_offered_slot" });
              await persistTurnFields(
                ctx.tenantId,
                ctx.lead.id,
                ctx.conversation.id,
                collected.fields ?? {},
                { extraSessionKeys: reservationEphemeralKeys(config) },
              );
              return { ok: true, decision: "accept" };
            }
            if (decision === "decline") {
              const replacement = spokenReplacementStay(
                lastLeadText(ctx),
                offer,
                fctx.now ?? zonedToday(),
                lang,
              );
              collected.fields = {
                ...(collected.fields ?? {}),
                staff_date_offer: "",
                reservation_confirm: "",
                reservation_flow: "active",
                ...(replacement
                  ? { check_in: replacement.checkIn, check_out: replacement.checkOut }
                  : {}),
              };
              if (replacement) {
                await movePendingReservationDates({
                  tenantId: ctx.tenantId,
                  reservationId: offer.reservationId,
                  checkIn: replacement.checkIn,
                  checkOut: replacement.checkOut,
                });
                collected.reply = r.offerReplacement(replacement.checkIn, replacement.checkOut);
                collected.replyLocked = true;
                return {
                  ok: true,
                  decision: "decline",
                  check_in: replacement.checkIn,
                  check_out: replacement.checkOut,
                };
              }
              pushReply(collected, r.offerDeclineAsk);
              return { ok: true, decision: "decline" };
            }
            pushReply(collected, r.offerUnclearAsk);
            return { ok: true, decision: "unclear" };
          },
        });
        return tools;
      }

      tools.save_fields = tool({
        description: `Save ${noun} field values from the customer.`,
        inputSchema: z.object({
          fields: z.record(z.string(), z.string()),
        }),
        execute: async ({ fields }) => {
          const saved = saveStayFields({
            raw: fields,
            spoken: lastLeadText(ctx),
            lang,
            specs,
            fctx,
            collected,
          });
          const next = lockNextStayQuestion(
            collected,
            { ...ctx.lead.fields, ...collected.fields },
            config,
            lang,
          );
          return { ok: true, saved, ...(next ? { next_field: next } : {}) };
        },
      });

      tools.ask_field = tool({
        description: `Ask for the first missing ${noun} field. A later field is redirected to that gap.`,
        inputSchema: z.object({
          field: z.string(),
        }),
        execute: async ({ field }) => {
          const next = lockNextStayQuestion(
            collected,
            { ...ctx.lead.fields, ...collected.fields },
            config,
            lang,
          );
          if (!next) return { ok: false, skip: true };
          return {
            ok: true,
            field: next,
            ...(next !== field ? { redirected_from: field } : {}),
          };
        },
      });

      if (!linkMode) {
        tools.check_availability = tool({
          description:
            `Check ${noun} availability using the tenant's configured calendar link probe (source of truth). Requires check_in and check_out as YYYY-MM-DD.`,
          inputSchema: z.object({}),
          execute: async () => {
            const merged = { ...ctx.lead.fields, ...collected.fields };
            ctx.lead.fields = merged;
            const result = await checkStayAvailability(ctx);
            collected.fields = {
              ...(collected.fields ?? {}),
              availability_status: result.status,
              availability_url: result.url,
            };
            pushReply(collected, result.replyHint);
            return {
              ok: true,
              status: result.status,
              url: result.url,
              hint: result.replyHint,
            };
          },
        });
      }
      tools.confirm_details = tool({
        description:
          linkMode
            ? `Present ${noun} details for customer confirmation before send_reservation_link. Only when gaps are none.`
            : `Present ${noun} details for customer confirmation before create_reservation_hold. Only when gaps are none.`,
        inputSchema: z.object({}),
        execute: async () => {
          const merged = { ...ctx.lead.fields, ...collected.fields };
          const gaps = reservationFieldGaps(merged, config);
          if (gaps.length) {
            return { ok: false, gaps };
          }
          if (!stayDatesValid(String(merged.check_in), String(merged.check_out))) {
            return { ok: false, error: "invalid_dates" };
          }
          const lines = [
            r.confirmTitle(noun),
            ...confirmLines(specs, merged, fctx).map((l) => `${l.label}: ${l.value}`),
            r.confirmAsk,
          ];
          pushReply(collected, lines.join("\n"));
          collected.fields = {
            ...(collected.fields ?? {}),
            reservation_confirm: "pending",
          };
          return { ok: true };
        },
      });

      if (linkMode) {
        tools.send_reservation_link = tool({
          description:
            `Send the self-serve booking link as soon as gaps are none. Do not wait for a spare OK. Never claim the ${noun} is confirmed.`,
          inputSchema: z.object({}),
          execute: async () => {
            const merged = { ...ctx.lead.fields, ...collected.fields };
            const gaps = reservationFieldGaps(merged, config);
            if (gaps.length) return { ok: false, gaps };
            if (!stayDatesValid(String(merged.check_in), String(merged.check_out))) {
              return { ok: false, error: "invalid_dates" };
            }
            collected.fields = {
              ...(collected.fields ?? {}),
              reservation_confirm: "sent_link",
            };
            ctx.lead.fields = { ...merged, reservation_confirm: "sent_link" };
            pushEffect(collected, { type: "send_reservation_link" });
            return { ok: true, pending_effect: true };
          },
        });
      } else {
        tools.create_reservation_hold = tool({
          description:
            `Submit a tentative ${noun} request for human approval as soon as gaps are none. Do not wait for a spare OK.`,
          inputSchema: z.object({}),
          execute: async () => {
            const merged = { ...ctx.lead.fields, ...collected.fields };
            const gaps = reservationFieldGaps(merged, config);
            if (gaps.length) return { ok: false, gaps };
            if (!stayDatesValid(String(merged.check_in), String(merged.check_out))) {
              return { ok: false, error: "invalid_dates" };
            }
            collected.fields = {
              ...(collected.fields ?? {}),
              reservation_confirm: "confirmed",
            };
            ctx.lead.fields = { ...merged, reservation_confirm: "confirmed" };
            pushEffect(collected, { type: "create_reservation_hold" });
            return { ok: true, pending_effect: true };
          },
        });
      }

      return tools;
    },
  });
}

function resolveReservationsEnabled(stage: { capabilities?: string[] }): boolean {
  return (stage.capabilities ?? []).includes("reservations");
}
