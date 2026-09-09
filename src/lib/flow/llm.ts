import { generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { copyFor, replyLang } from "@/lib/copy";
import { missingRequired } from "./helpers";
import {
  askBookingField,
  bookingConfirmStatus,
  bookingFieldGaps,
  capturePriorBookingAnswer,
  gateBookOnGaps,
  isMidBookingCollect,
  matchAskedBookingField,
} from "./booking";
import {
  callbackPhone,
  effectiveBookingRequired,
  looksLikePhoneNumber,
  savedPhone,
} from "./booking-collect";
import { talkGuardrails } from "./guardrails";
import { hasAgentReplied } from "./intro";
import { chatModel, llmConfigured } from "./model";
import type { CollectStage, FaqStage, LeadFields, Stage, TalkOutcome, TalkStage, TurnContext } from "./types";
import { getStaffSlotOffer, markMeetingDecision } from "@/lib/meetings";
import { proposesDifferentSlot } from "./slot";

function lastLeadText(ctx: TurnContext): string {
  const last = [...ctx.messages].reverse().find((m) => m.role === "lead");
  return last?.text ?? "";
}

function venueHours(ctx: TurnContext): string {
  return ctx.tenant?.venueHours?.trim() ?? "";
}

function venueAddress(ctx: TurnContext): string {
  return ctx.tenant?.venueAddress?.trim() ?? "";
}

export async function classifyIntent(
  ctx: TurnContext,
  stage: Extract<Stage, { type: "classify" }>,
): Promise<string> {
  if (!llmConfigured()) {
    return stage.intents[0];
  }
  const { object } = await generateObject({
    model: chatModel(),
    schema: z.object({ intent: z.enum(stage.intents as [string, ...string[]]) }),
    system: stage.prompt,
    prompt: ctx.messages
      .slice(-8)
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n"),
  });
  return object.intent;
}

export async function extractFields(
  ctx: TurnContext,
  stage: CollectStage,
): Promise<LeadFields> {
  const keys = [...stage.required_fields, ...(stage.optional_fields ?? [])];
  const missing = missingRequired(ctx.lead.fields, stage.required_fields);
  if (!llmConfigured()) return {};

  try {
    const shape = Object.fromEntries(keys.map((k) => [k, z.string().optional()]));
    const { object } = await generateObject({
      model: chatModel(),
      schema: z.object(shape),
      system: copyFor(replyLang(ctx, lastLeadText(ctx))).prompts.extractFields(
        missing[0] ?? keys[0],
      ),
      prompt: [
        `Known: ${JSON.stringify(ctx.lead.fields)}`,
        `Still needed: ${missing.join(", ") || "none"}`,
        ctx.messages
          .slice(-12)
          .map((m) => `${m.role}: ${m.text}`)
          .join("\n"),
      ].join("\n"),
    });
    const fromLlm: LeadFields = {};
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "string" && value.trim()) fromLlm[key] = value.trim();
    }
    return fromLlm;
  } catch (err) {
    console.error("extract fromLlm failed", err);
    return {};
  }
}

export async function draftQuestion(
  ctx: TurnContext,
  stage: CollectStage,
  missing: string[],
): Promise<string> {
  const nextField = missing[0];
  const last = lastLeadText(ctx);
  const lang = replyLang(ctx, last);
  if (!llmConfigured()) {
    return askBookingField(lang, nextField, {
      hours: venueHours(ctx),
      deducedPhone: nextField === "phone" ? callbackPhone(ctx) : undefined,
    });
  }
  const { text } = await generateText({
    model: chatModel(),
    system: `${stage.prompt}\n${ctx.agent.systemPrompt}\n${copyFor(lang).prompts.draftQuestion(nextField)}`,
    prompt: JSON.stringify({ fields: ctx.lead.fields, missing, lastCustomerMessage: last }),
  });
  return text.trim();
}

export async function answerFaq(
  ctx: TurnContext,
  stage: FaqStage,
): Promise<{ resolved: boolean; reply: string }> {
  const knowledge = ctx.agent.knowledgeText.trim();
  const question = lastLeadText(ctx);
  const lang = replyLang(ctx, question);
  const chat = copyFor(lang).chat;
  if (!knowledge) {
    return { resolved: false, reply: chat.faqNoKnowledge };
  }
  const { text } = await generateText({
    model: chatModel(),
    system: copyFor(lang).prompts.faqSystem(stage.prompt, knowledge),
    prompt: question,
  });
  if (text.includes("UNRESOLVED")) {
    return { resolved: false, reply: chat.faqUnresolved };
  }
  return { resolved: true, reply: text.trim() };
}

export { hasAgentReplied } from "./intro";
export { introGreeting } from "@/lib/copy";

/** Offline stub when LLM is unavailable - no language heuristics. */
export function heuristicTalk(ctx: TurnContext, stage: TalkStage): TalkOutcome {
  const last = lastLeadText(ctx);
  const lang = replyLang(ctx, last);
  const chat = copyFor(lang).chat;
  const required = effectiveBookingRequired(ctx);
  const hours = venueHours(ctx);
  const priorAgent =
    [...ctx.messages].reverse().find((m) => m.role === "agent")?.text ?? "";
  const captured = capturePriorBookingAnswer({
    priorAgentText: priorAgent,
    customerText: last,
    fields: ctx.lead.fields,
    required,
    lang,
    hours,
    deducedPhone: callbackPhone(ctx),
  });
  const fields = { ...ctx.lead.fields, ...captured };

  if (!hasAgentReplied(ctx)) {
    return { reply: "", fields: captured };
  }

  const offer = getStaffSlotOffer(fields);
  if (offer) {
    return {
      reply:
        lang === "he"
          ? `המועד המוצע הוא ${offer.slot}. האם זה מתאים לך?`
          : `The offered time is ${offer.slot}. Does that work for you?`,
      fields: captured,
    };
  }

  if (stage.allowBook !== false && isMidBookingCollect(fields, required)) {
    const gaps = bookingFieldGaps(fields, required);
    if (gaps.length === 0 && bookingConfirmStatus(fields) === "confirmed") {
      return { reply: chat.savingVisit, book: true, fields: captured };
    }
    if (gaps.length > 0) {
      return {
        reply: askBookingField(lang, gaps[0], {
          hours,
          deducedPhone: gaps[0] === "phone" ? callbackPhone(ctx) : undefined,
        }),
        fields: captured,
      };
    }
  }

  return { reply: chat.tellMeMore, fields: captured };
}

function talkSystem(
  ctx: TurnContext,
  stage: TalkStage,
  fields: LeadFields = ctx.lead.fields,
): string {
  const last = lastLeadText(ctx);
  const lang = replyLang(ctx, last);
  const hours = venueHours(ctx);
  const required = effectiveBookingRequired(ctx);
  const deduced = callbackPhone(ctx) ?? "";
  const saved = savedPhone(fields);
  const gaps = bookingFieldGaps(fields, required);
  const confirm = bookingConfirmStatus(fields);
  const whatsapp = ctx.channel?.provider === "whatsapp";
  const midBooking =
    stage.allowBook !== false && isMidBookingCollect(fields, required);
  const offered = getStaffSlotOffer(fields);
  const channelLine = whatsapp
    ? saved
      ? `Channel: WhatsApp. Callback phone already saved: ${saved}.`
      : deduced
        ? `Channel: WhatsApp. Deduced callback candidate: ${deduced}. Only when mid-booking, confirm with the customer, then save_fields phone=${deduced}.`
        : `Channel: WhatsApp. No callback number yet - ask_field phone only when mid-booking and phone is required.`
    : `Channel: ${ctx.channel?.provider ?? "chat"}.`;
  const offerLines = offered
    ? [
        `A teammate offered an alternative visit slot and is waiting on the customer: "${offered.slot}" (previous was "${offered.previousSlot || "n/a"}").`,
        "Read their latest message and call resolve_offered_slot with your decision:",
        '- decision="accept" ONLY if they clearly agree to THAT exact offered slot (e.g. yes / כן / that works) with no other day or time named.',
        '- decision="decline" if they reject it, ask to book a different day/time, or name any other slot (pass proposed_slot with their wording).',
        '- decision="unclear" if you cannot tell — then reply asking only whether that offered time works.',
        "Never treat a fresh booking request (e.g. I want Sunday at 11) as accept of the staff offer.",
        "Do NOT call ask_field, book_meeting, or confirm_details while this offer is pending.",
        "Do NOT invent a new booking request for the same offer.",
      ]
    : [];
  const bookingLines = offered
    ? []
    : midBooking
      ? [
          `Mid-booking. Gaps: ${gaps.join(", ") || "none"}. booking_confirm=${confirm || "(none)"}.`,
          "When they answer a booking question, call save_fields with their wording first, then ask_field for the next gap only.",
          "time_preference: weekday + clock (e.g. Thursday 12:00 / חמישי ב-12:00) is enough - do not require a calendar date. Save as-is. If unusable, save_fields time_preference=\"\" to clear and ask_field time_preference again.",
          "Before book_meeting: call confirm_details so the customer sees date/time/name/phone/need; after they agree, save_fields booking_confirm=confirmed then book_meeting.",
        ]
      : [
          "Not mid-booking. Answer the customer's question with reply. Do NOT call ask_field. Do not ask for name/phone/time/need unless they clearly want a visit/meeting or agree to one you offered.",
          "If they do ask to book, then start collecting required fields one at a time.",
        ];
  return [
    ctx.agent.systemPrompt,
    stage.prompt,
    talkGuardrails({
      allowBook: stage.allowBook !== false,
      requiredForBook: required,
      hours,
      whatsappPhone: !saved && deduced ? deduced : undefined,
      lang,
    }),
    copyFor(lang).prompts.talkContext({
      business: ctx.tenant?.name ?? "this business",
      intro: ctx.tenant?.intro?.trim() || "(no intro yet)",
      knowledge: ctx.agent.knowledgeText,
      fieldsJson: JSON.stringify(fields),
      channelLine,
      requiredFields: required.join(", "),
      hours,
      address: venueAddress(ctx),
      last,
    }),
    ...offerLines,
    ...bookingLines,
    "Call set_intent every turn. Call reply unless ask_field or resolve_offered_slot already set the outbound text.",
  ].join("\n");
}

export async function talkTurn(ctx: TurnContext, stage: TalkStage): Promise<TalkOutcome> {
  if (!llmConfigured()) {
    return heuristicTalk(ctx, stage);
  }

  const lang = replyLang(ctx, lastLeadText(ctx));
  const hours = venueHours(ctx);
  const required = effectiveBookingRequired(ctx);
  const last = lastLeadText(ctx);
  const priorAgent =
    [...ctx.messages].reverse().find((m) => m.role === "agent")?.text ?? "";
  const captured = capturePriorBookingAnswer({
    priorAgentText: priorAgent,
    customerText: last,
    fields: ctx.lead.fields,
    required,
    lang,
    hours,
    deducedPhone: callbackPhone(ctx),
  });
  const fieldsForTurn = { ...ctx.lead.fields, ...captured };
  const offered = getStaffSlotOffer(fieldsForTurn);

  const collected: TalkOutcome & { askFieldUsed?: boolean } = {
    reply: "",
    fields: { ...captured },
  };
  const fieldShape = Object.fromEntries(
    Object.keys(ctx.agent.leadSchema.fields)
      .filter((k) => k !== "intent")
      .map((k) => [k, z.string().optional()]),
  );
  fieldShape.booking_confirm = z.string().optional();

  const baseTools = {
        reply: tool({
          description:
            "User-facing message. Call once unless ask_field or resolve_offered_slot already set the outbound text.",
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }: { text: string }) => {
            if (!collected.askFieldUsed && !collected.acceptOfferedSlot) {
              collected.reply = text.trim();
            }
            return "ok";
          },
        }),
        set_intent: tool({
          description:
            "What they want: sales (buy/book/quote), support (warranty, complaint, no-show), or other. Call every turn.",
          inputSchema: z.object({ intent: z.enum(["sales", "support", "other"]) }),
          execute: async ({ intent }: { intent: "sales" | "support" | "other" }) => {
            collected.intent = intent;
            return "ok";
          },
        }),
  };

  const offerTools = offered
    ? {
        resolve_offered_slot: tool({
          description:
            "Decide whether the customer accepted the teammate's offered alternative visit slot. Call this when a staff offer is pending. On accept, the system approves the meeting. Never accept if they named a different day or time — use decline + proposed_slot instead.",
          inputSchema: z.object({
            decision: z.enum(["accept", "decline", "unclear"]),
            reason: z.string().optional(),
            /** Their alternative day/time wording when declining the staff offer. */
            proposed_slot: z.string().optional(),
          }),
          execute: async ({
            decision: rawDecision,
            proposed_slot,
          }: {
            decision: "accept" | "decline" | "unclear";
            reason?: string;
            proposed_slot?: string;
          }) => {
            const proposedFromMsg = proposesDifferentSlot(last, offered.slot, { lang });
            const proposedText =
              proposed_slot?.trim() ||
              (proposedFromMsg ? last.trim() : "");
            // Guard: never approve when they clearly asked for another slot.
            let decision = rawDecision;
            if (decision === "accept" && proposedFromMsg) {
              decision = "decline";
            }
            if (decision === "accept") {
              const result = await markMeetingDecision({
                tenantId: ctx.tenantId,
                meetingId: offered.meetingId,
                actorUserId: "customer",
                decision: "approve",
                customerConfirmed: true,
              });
              collected.acceptOfferedSlot = true;
              collected.book = false;
              collected.complete = false;
              collected.reply = result.text;
              collected.fields = { ...collected.fields, staff_slot_offer: "" };
              return JSON.stringify({ ok: true, decision: "accept" });
            }
            if (decision === "decline") {
              collected.acceptOfferedSlot = false;
              collected.book = false;
              const nextFields: LeadFields = { ...collected.fields, staff_slot_offer: "" };
              if (proposedText) {
                nextFields.time_preference = proposedText;
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
            return JSON.stringify({ ok: true, decision: "unclear" });
          },
        }),
      }
    : {};

  const bookingTools = offered
    ? {}
    : {
        save_fields: tool({
          description:
            "Save details they already gave in chat, in their original wording. Do not invent. Do not translate names. Do not copy the WhatsApp/profile display name into name — only save a name they typed. For phone, only save after they gave or confirmed a number. For time_preference, save natural day+time as-is (no calendar date required). Pass an empty string to clear a field you decide is unusable. Set booking_confirm to pending|confirmed around confirm_details.",
          inputSchema: z.object(fieldShape),
          execute: async (raw: Record<string, unknown>) => {
            const fields: LeadFields = {};
            for (const [key, value] of Object.entries(raw)) {
              if (typeof value !== "string") continue;
              if (!value.trim()) {
                fields[key] = "";
                continue;
              }
              if (key === "phone" && !looksLikePhoneNumber(value) && value !== callbackPhone(ctx)) {
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
            "Ask for one missing booking field ONLY when mid-booking or the customer clearly wants a visit/meeting. Never use on a FAQ/product question. Only fields in the required booking list. Always save_fields for their previous answer before asking the next field. Sets outbound text to that ask (no extra chatter).",
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
            collected.reply = askBookingField(lang, field, {
              hours,
              deducedPhone: field === "phone" ? callbackPhone(ctx) : undefined,
            });
            collected.book = false;
            return collected.reply;
          },
        }),
        confirm_details: tool({
          description:
            "Present the visit details for the customer to confirm before book_meeting. Include date/time, name, phone, need. Then save_fields booking_confirm=pending until they agree.",
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }: { text: string }) => {
            collected.reply = text.trim();
            collected.fields = {
              ...collected.fields,
              booking_confirm: "pending",
            };
            collected.book = false;
            return "ok";
          },
        }),
        book_meeting: tool({
          description:
            "Record a tentative visit after required fields are known AND booking_confirm=confirmed. Do not claim the visit is confirmed with the business.",
          inputSchema: z.object({ confirm: z.boolean() }),
          execute: async () => {
            if (stage.allowBook === false) return JSON.stringify({ ok: false, error: "disabled" });
            const merged = { ...fieldsForTurn, ...collected.fields };
            for (const [key, value] of Object.entries(collected.fields ?? {})) {
              if (value === "") delete merged[key];
            }
            const gaps = bookingFieldGaps(merged, required);
            if (gaps.length > 0) {
              collected.book = false;
              return JSON.stringify({ ok: false, missing: gaps });
            }
            if (bookingConfirmStatus(merged) !== "confirmed") {
              collected.book = false;
              return JSON.stringify({
                ok: false,
                missing: ["booking_confirm"],
                hint: "Call confirm_details, then save_fields booking_confirm=confirmed after they agree.",
              });
            }
            collected.book = true;
            return JSON.stringify({ ok: true });
          },
        }),
        request_human: tool({
          description: "Hand off to a person when policy allows.",
          inputSchema: z.object({ reason: z.string() }),
          execute: async ({ reason }: { reason: string }) => {
            collected.escalate = true;
            collected.escalateReason = reason.trim() || "escalation_requested";
            return "queued";
          },
        }),
      };

  try {
    const result = await generateText({
      model: chatModel(),
      system: talkSystem(ctx, stage, fieldsForTurn),
      prompt: ctx.messages
        .slice(-12)
        .map((m) => `${m.role}: ${m.text}`)
        .join("\n"),
      tools: (offered
        ? { ...baseTools, ...offerTools }
        : { ...baseTools, ...bookingTools }) as Parameters<typeof generateText>[0]["tools"],
      stopWhen: stepCountIs(8),
      maxRetries: 2,
    });

    if (!collected.reply && result.text?.trim()) {
      collected.reply = result.text.trim();
    }
  } catch (err) {
    console.error("talkTurn LLM failed, using heuristic", err);
    return heuristicTalk(ctx, stage);
  }

  if (
    !collected.reply &&
    !collected.escalate &&
    !collected.book &&
    !collected.acceptOfferedSlot
  ) {
    return heuristicTalk(ctx, stage);
  }

  if (collected.acceptOfferedSlot) {
    return collected;
  }

  const merged: LeadFields = { ...fieldsForTurn, ...collected.fields };
  for (const [key, value] of Object.entries(collected.fields ?? {})) {
    if (value === "") delete merged[key];
  }
  const gaps = bookingFieldGaps(merged, required);
  // If the model re-asked a field we already captured this turn, advance to the next gap.
  if (collected.askFieldUsed && collected.reply) {
    const asking = matchAskedBookingField(collected.reply, lang, required, {
      hours,
      deducedPhone: callbackPhone(ctx),
    });
    if (asking && !gaps.includes(asking)) {
      if (gaps.length > 0) {
        collected.reply = askBookingField(lang, gaps[0], {
          hours,
          deducedPhone: gaps[0] === "phone" ? callbackPhone(ctx) : undefined,
        });
      }
    }
  }
  const gated = gateBookOnGaps({ book: collected.book, gaps });
  if (gated.book && bookingConfirmStatus(merged) !== "confirmed") {
    collected.book = false;
  } else {
    collected.book = gated.book;
  }
  return collected;
}
