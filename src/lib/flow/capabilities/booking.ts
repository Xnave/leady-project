import { tool } from "ai";
import { z } from "zod";
import { replyLang } from "@/lib/copy";
import { askBookingField, bookingConfirmStatus, bookingFieldGaps, gateBookOnGaps, isBookingCollectActive } from "../booking";
import {
  callbackPhone,
  effectiveBookingRequired,
  looksLikePhoneNumber,
} from "../booking-collect";
import { registerCapability } from "../registry";
import type { LeadFields, TalkOutcome, TalkStage, TurnContext } from "../types";
import { getStaffSlotOffer, markMeetingDecision } from "@/lib/meetings";
import { proposesDifferentSlot } from "../slot";

export type TalkCollected = TalkOutcome & {
  askFieldUsed?: boolean;
  replyLocked?: boolean;
};

function lastLeadText(ctx: TurnContext): string {
  return [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
}

function pushEffect(collected: TalkCollected, effect: NonNullable<TalkOutcome["effects"]>[number]) {
  collected.effects = [...(collected.effects ?? []), effect];
}

/** Booking capability: tools + prompt lines for visit requests. */
export function registerBookingCapability(): void {
  registerCapability({
    id: "booking",
    promptSection: ({ ctx, fields }) => {
      const required = effectiveBookingRequired(ctx);
      if (!isBookingCollectActive(fields, required)) {
        return [
          "Booking capability available but idle.",
          "Do NOT ask for day/time yet. Answer with reply. Call start_booking only after an explicit schedule request.",
        ];
      }
      const gaps = bookingFieldGaps(fields, required);
      return [
        `Booking in progress. Required fields: ${required.join(", ")}.`,
        `Current gaps: ${gaps.join(", ") || "none"}.`,
        "Never say the visit is confirmed — book_meeting only stores a tentative request for a human.",
      ];
    },
    tools: ({ ctx, stage, collected }) => {
      const lang = replyLang(ctx, lastLeadText(ctx));
      const hours = ctx.tenant?.venueHours?.trim() ?? "";
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
        };
      }

      if (!active) {
        return {
          start_booking: tool({
            description:
              "Begin collecting visit/meeting details. Call ONLY when the customer explicitly asks to schedule a meeting, visit, demo, or call — or clearly accepts your offer to book one. Do NOT call for product interest alone (e.g. wanting a WhatsApp agent, asking how it works, pricing, features).",
            inputSchema: z.object({
              reason: z.string().optional(),
            }),
            execute: async () => {
              const first = required[0] ?? "time_preference";
              collected.fields = {
                ...collected.fields,
                booking_flow: "active",
              };
              collected.askFieldUsed = true;
              collected.replyLocked = true;
              collected.reply = askBookingField(lang, first, {
                hours,
                deducedPhone: first === "phone" ? callbackPhone(ctx) : undefined,
              });
              return JSON.stringify({ ok: true, next_field: first });
            },
          }),
        };
      }

      const fieldShape = Object.fromEntries(
        Object.keys(ctx.agent.leadSchema.fields)
          .filter((k) => k !== "intent")
          .map((k) => [k, z.string().optional()]),
      );
      fieldShape.booking_confirm = z.string().optional();
      fieldShape.booking_flow = z.string().optional();

      return {
        save_fields: tool({
          description:
            "Save details they already gave in chat, in their original wording. Do not invent. Do not translate names. Do not copy the WhatsApp/profile display name into name. For phone, only save after they gave or confirmed a number. Pass empty string to clear a field.",
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
              fields[key] = value.trim();
            }
            collected.fields = { ...collected.fields, ...fields };
            return "ok";
          },
        }),
        ask_field: tool({
          description:
            "Ask for one missing booking field while visit booking is already in progress. Only fields in the required booking list. Sets outbound text to that ask.",
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
            collected.askFieldUsed = true;
            collected.replyLocked = true;
            collected.reply = askBookingField(lang, field, {
              hours,
              deducedPhone: field === "phone" ? callbackPhone(ctx) : undefined,
            });
            return collected.reply;
          },
        }),
        confirm_details: tool({
          description:
            "Present the visit details for the customer to confirm before book_meeting. Then save_fields booking_confirm=pending until they agree.",
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }: { text: string }) => {
            collected.reply = text.trim();
            collected.replyLocked = true;
            collected.fields = {
              ...collected.fields,
              booking_confirm: "pending",
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

