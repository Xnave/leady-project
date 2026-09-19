import { tool } from "ai";
import { z } from "zod";
import { registerCapability } from "../registry";
import type { LeadFields, TalkOutcome, TurnContext } from "../types";
import { copyFor, replyLang } from "@/lib/copy";
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
} from "@/lib/reservations";
import { persistTurnFields } from "@/lib/conversations";

function lastLeadText(ctx: TurnContext): string {
  return [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
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

/** Stay reservations capability — behavior driven by its CapabilityInstance config. */
export function registerReservationsCapability(): void {
  registerCapability({
    id: "reservations",
    sessionFieldKeys: RESERVATION_SESSION_FIELD_KEYS,
    // The tenant's configured collect list is ephemeral too, so it varies per tenant.
    dynamicSessionKeys: (ctx) => reservationEphemeralKeys(reservationConfigFromCtx(ctx)),
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
      "Never say a request is confirmed — create_reservation_hold only stores a tentative request for a human.",
      "Call reply unless ask_field already set the outbound text.",
    ],
    promptSection: ({ ctx, fields }) => {
      const config = reservationConfigFromCtx(ctx);
      const noun = reservationVocab(config, "en").noun.singular;
      const offered = getStaffDateOffer(fields);
      const collectList = reservationCollectFields(config).join(", ");

      if (offered) {
        return [
          `A teammate offered alternative ${noun} dates: ${offered.checkIn} → ${offered.checkOut} (was ${offered.previousCheckIn} → ${offered.previousCheckOut}).`,
          "If they clearly accept those exact dates, save_fields check_in/check_out then create_reservation_hold after confirm_details.",
          "If they decline or propose other dates, reply and collect new dates — do not invent confirmation.",
        ];
      }

      const active = isReservationCollectActive(fields);
      if (active) {
        const gaps = reservationFieldGaps(fields, config);
        const confirm = reservationConfirmStatus(fields);
        const lines = [
          `${noun} request is in progress. Collect fields: ${collectList}. Gaps: ${gaps.join(", ") || "none"}. reservation_confirm=${confirm || "(none)"}.`,
          "Save dates as YYYY-MM-DD (check_in / check_out). check_out must be after check_in.",
          "After dates are saved, call check_availability before finishing the hold when possible.",
          "Before create_reservation_hold: confirm_details when Gaps is none, then save_fields reservation_confirm=confirmed after they agree, then create_reservation_hold.",
          `CRITICAL: Never tell the customer you submitted a ${noun} request unless create_reservation_hold returned ok.`,
          `Never say the ${noun} is confirmed — only a human can approve.`,
          ...policyLines(config),
        ];
        if (!hasRates(config)) {
          lines.push(
            "No rate table is configured — do NOT invent prices. Answer amenity/policy questions from knowledge, or escalate discount/price asks to a human / send the booking link if configured.",
          );
        } else {
          lines.push(
            "A rate table is configured — only state prices that clearly follow it; otherwise say a teammate will confirm the total.",
          );
        }
        if (config.bookingLinkTemplate) {
          lines.push(
            "A bookingLinkTemplate is configured — you may share the filled link after availability check or when the customer wants to self-serve.",
          );
        }
        return lines;
      }

      return [
        `${noun} request is NOT started. Answer questions from knowledge with reply.`,
        `Only call start_reservation when they clearly want to book a ${noun} / check dates (not a sales meeting).`,
        `When collecting, fields are: ${collectList}.`,
        "Do not invent prices unless a rate table is configured on this tenant.",
        ...policyLines(config),
        "Price questions without a configured rate table → do not invent amounts; offer availability check / human / booking link.",
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

      const tools: Record<string, unknown> = {};

      if (!active && !offered) {
        tools.start_reservation = tool({
          description:
            `Start collecting a ${noun} request (start/end dates and configured fields). Only when they clearly want those dates.`,
          inputSchema: z.object({}),
          execute: async () => {
            collected.fields = {
              ...(collected.fields ?? {}),
              reservation_flow: "active",
              reservation_confirm: "",
            };
            const gaps = reservationFieldGaps(
              { ...ctx.lead.fields, ...collected.fields },
              config,
            );
            const first = gaps[0] ?? "check_in";
            const q = askReservationField(lang, first, config);
            pushReply(collected, q);
            collected.askFieldUsed = true;
            return { ok: true, next_field: first };
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
          const { confirm, collectable } = splitReservationConfirm(fields);
          // The field kit owns coercion (dates → ISO, option labels → ids) and
          // drops keys this tenant does not collect.
          const { values } = normalizeFields(specs, collectable, fctx);
          collected.fields = {
            ...(collected.fields ?? {}),
            ...values,
            ...confirm,
          };
          return { ok: true, saved: Object.keys(values) };
        },
      });

      tools.ask_field = tool({
        description: `Ask for the next missing ${noun} field.`,
        inputSchema: z.object({
          field: z.string(),
        }),
        execute: async ({ field }) => {
          const q = askReservationField(lang, field, config);
          pushReply(collected, q);
          collected.askFieldUsed = true;
          return { ok: true, field };
        },
      });

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

      tools.confirm_details = tool({
        description:
          `Present ${noun} details for customer confirmation before create_reservation_hold. Only when gaps are none.`,
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

      tools.create_reservation_hold = tool({
        description:
          `Submit a tentative ${noun} request for human approval. Only after reservation_confirm=confirmed and gaps are none.`,
        inputSchema: z.object({}),
        execute: async () => {
          const merged = { ...ctx.lead.fields, ...collected.fields };
          const gaps = reservationFieldGaps(merged, config);
          if (gaps.length) return { ok: false, gaps };
          if (reservationConfirmStatus(merged) !== "confirmed") {
            return { ok: false, error: "not_confirmed" };
          }
          ctx.lead.fields = merged;
          pushEffect(collected, { type: "create_reservation_hold" });
          return { ok: true, pending_effect: true };
        },
      });

      tools.resolve_offered_dates = tool({
        description:
          `Accept or decline staff-offered alternative ${noun} dates.`,
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
              reservation_flow: "active",
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
            collected.fields = {
              ...(collected.fields ?? {}),
              staff_date_offer: "",
              reservation_confirm: "",
              reservation_flow: "active",
            };
            pushReply(collected, r.offerDeclineAsk);
            return { ok: true, decision: "decline" };
          }
          pushReply(collected, r.offerUnclearAsk);
          return { ok: true, decision: "unclear" };
        },
      });

      return tools;
    },
  });
}

function resolveReservationsEnabled(stage: { capabilities?: string[] }): boolean {
  return (stage.capabilities ?? []).includes("reservations");
}
