import { tool } from "ai";
import { z } from "zod";
import { copyFor, replyLang } from "@/lib/copy";
import { askBookingField, bookingConfirmStatus, bookingFieldGaps, gateBookOnGaps, isBookingCollectActive } from "../booking";
import {
  callbackPhone,
  effectiveBookingRequired,
  looksLikePhoneNumber,
  savedPhone,
} from "../booking-collect";
import { registerCapability } from "../registry";
import type { LeadFields, TalkOutcome, TalkStage, TurnContext } from "../types";
import { getStaffSlotOffer, markMeetingDecision, updateMeetingDetails } from "@/lib/meetings";
import { proposesDifferentSlot } from "../slot";
import { formatPhoneDisplay, rewritePhonesInText } from "@/lib/leads";

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
  const meetingId = ctx.recentMeeting?.id;
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
    promptSection: ({ ctx, fields }) => {
      const required = effectiveBookingRequired(ctx);
      const recent = ctx.recentMeeting;
      const lang = replyLang(ctx, lastLeadText(ctx));
      const staffNote = lastStaffNoteQuestion(ctx, lang);
      if (recent && (recent.status === "approved" || recent.status === "pending")) {
        const lines = [
          `Recent meeting on this lead (id=${recent.id}): status=${recent.status}, slot="${recent.slotText}", need="${recent.needText || "(empty)"}", name="${recent.contactName || ""}".`,
          "This is a CONTINUATION of that meeting thread — not a new sales conversation.",
          "If they give concrete meeting details (פרטי הפגישה), call update_meeting_details with their wording, then reply in the SAME turn.",
          "If they say details are wrong but give no replacement, do NOT call update_meeting_details — only reply and ask what to write. Never invent a staff/CRM note.",
          "Do NOT send a business intro, do NOT restart a product pitch, do NOT call start_booking unless they explicitly ask for a new/different meeting.",
        ];
        if (staffNote) {
          lines.push(`Latest staff note / question still in thread: "${staffNote}". Treat the customer's reply as answering it when relevant.`);
        }
        if (!isBookingCollectActive(fields, required)) {
          return lines;
        }
        return [...lines, `Booking collect still active. Required: ${required.join(", ") || "none"}.`];
      }
      if (!isBookingCollectActive(fields, required)) {
        return [
          "Booking capability available but idle.",
          "Do NOT ask for day/time yet. Answer with reply. Call start_booking only after an explicit schedule request.",
          "If a recent meeting exists and they only add or correct details, use update_meeting_details + reply (same turn) instead of pitching.",
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
          update_meeting_details: updateMeetingDetailsTool(ctx, collected),
        };
      }

      if (!active) {
        return {
          start_booking: tool({
            description:
              "Begin collecting visit/meeting details. Call ONLY when the customer explicitly asks to schedule a meeting, visit, demo, or call — or clearly accepts your offer to book one. Do NOT call for product interest alone (e.g. wanting a WhatsApp agent, asking how it works, pricing, features). Do NOT call when they are only clarifying details for an existing/approved meeting — use update_meeting_details + reply instead.",
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
          update_meeting_details: updateMeetingDetailsTool(ctx, collected),
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
        update_meeting_details: updateMeetingDetailsTool(ctx, collected),
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
              if (key === "name" && value.trim()) {
                fields.name_collected_by_agent = "1";
              }
            }
            collected.fields = { ...collected.fields, ...fields };
            return "ok";
          },
        }),
        ask_field: tool({
          description:
            "Ask for one missing booking field while visit booking is already in progress. Only fields in the required booking list. Sets outbound text to that ask. For name: ask for a full name when the stored value looks like a nickname or partial name, unless name_collected_by_agent is already set.",
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
            "Present the visit details for the customer to confirm before book_meeting. Then save_fields booking_confirm=pending until they agree. Always write the phone using the display form from the system (local 0XX-XXX-XXXX), never +972.",
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }: { text: string }) => {
            const merged = { ...fieldsForTurn, ...collected.fields };
            const phoneRaw = savedPhone(merged) || callbackPhone(ctx) || "";
            const displayPhone = formatPhoneDisplay(phoneRaw) || phoneRaw;
            collected.reply = rewritePhonesInText(text.trim(), [
              phoneRaw,
              displayPhone,
              callbackPhone(ctx),
            ]);
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

