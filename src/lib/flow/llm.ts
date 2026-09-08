import { generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { copyFor, replyLang } from "@/lib/copy";
import { lastAgentText } from "./locale";
import { missingRequired } from "./helpers";
import {
  askBookingField,
  bookingFieldGaps,
  finalizeTalkReply,
  inferTalkIntent,
  looksLikePhoneConfirm,
} from "./booking";
import {
  callbackPhone,
  effectiveBookingRequired,
  looksLikePhoneNumber,
  savedPhone,
} from "./booking-collect";
import { talkGuardrails } from "./guardrails";
import { hasAgentReplied, looksLikeBareHello } from "./intro";
import { chatModel, llmConfigured } from "./model";
import type { CollectStage, FaqStage, LeadFields, Stage, TalkOutcome, TalkStage, TurnContext } from "./types";

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

/** Accept a typed number, or confirm the deduced chat number on a short "yes". */
function phoneFieldsFromTurn(ctx: TurnContext, collected: LeadFields): LeadFields {
  const fields = { ...collected };
  if (savedPhone(fields) || savedPhone(ctx.lead.fields)) return fields;
  const last = lastLeadText(ctx);
  if (looksLikePhoneNumber(last)) {
    fields.phone = last.trim();
    return fields;
  }
  const deduced = callbackPhone(ctx);
  if (deduced && looksLikePhoneConfirm(last)) {
    fields.phone = deduced;
  }
  return fields;
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
    return askBookingField(lang, nextField, { hours: venueHours(ctx) });
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

export function heuristicTalk(ctx: TurnContext, stage: TalkStage): TalkOutcome {
  const last = lastLeadText(ctx);
  const lang = replyLang(ctx, last);
  const chat = copyFor(lang).chat;
  const fields = phoneFieldsFromTurn(ctx, {});
  const required = effectiveBookingRequired(ctx);

  if (!hasAgentReplied(ctx)) {
    if (looksLikeBareHello(last)) {
      return { reply: "", fields };
    }
    return { reply: chat.tellMeMore, fields };
  }

  if (stage.allowBook !== false) {
    const merged = { ...ctx.lead.fields, ...fields };
    const gaps = bookingFieldGaps(merged, required);
    if (gaps.length === 0) {
      return { reply: chat.savingVisit, fields, book: true };
    }
  }

  return { reply: chat.tellMeMore, fields };
}

function talkSystem(ctx: TurnContext, stage: TalkStage): string {
  const last = lastLeadText(ctx);
  const lang = replyLang(ctx, last);
  const hours = venueHours(ctx);
  const required = effectiveBookingRequired(ctx);
  const deduced = callbackPhone(ctx) ?? "";
  const saved = savedPhone(ctx.lead.fields);
  const whatsapp = ctx.channel?.provider === "whatsapp";
  const channelLine = whatsapp
    ? saved
      ? `Channel: WhatsApp. Callback phone already saved: ${saved}.`
      : deduced
        ? `Channel: WhatsApp. Deduced callback candidate: ${deduced}. Confirm it before book_meeting; on confirm save_fields phone=${deduced}.`
        : `Channel: WhatsApp. No callback number yet — ask for phone if required.`
    : `Channel: ${ctx.channel?.provider ?? "chat"}.`;
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
      fieldsJson: JSON.stringify(ctx.lead.fields),
      channelLine,
      requiredFields: required.join(", "),
      hours,
      address: venueAddress(ctx),
      last,
    }),
  ].join("\n");
}

export async function talkTurn(ctx: TurnContext, stage: TalkStage): Promise<TalkOutcome> {
  if (!llmConfigured()) {
    return heuristicTalk(ctx, stage);
  }

  const collected: TalkOutcome = { reply: "" };
  const fieldShape = Object.fromEntries(
    Object.keys(ctx.agent.leadSchema.fields)
      .filter((k) => k !== "intent")
      .map((k) => [k, z.string().optional()]),
  );

  try {
    const result = await generateText({
      model: chatModel(),
      system: talkSystem(ctx, stage),
      prompt: ctx.messages
        .slice(-12)
        .map((m) => `${m.role}: ${m.text}`)
        .join("\n"),
      tools: {
        reply: tool({
          description: "User-facing message. Always call this once.",
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }: { text: string }) => {
            collected.reply = text.trim();
            return "ok";
          },
        }),
        set_intent: tool({
          description:
            "What they want: sales (buy/book/quote), support (warranty, complaint, no-show), or other. Call this every turn.",
          inputSchema: z.object({ intent: z.enum(["sales", "support", "other"]) }),
          execute: async ({ intent }: { intent: "sales" | "support" | "other" }) => {
            collected.intent = intent;
            return "ok";
          },
        }),
        save_fields: tool({
          description:
            "Save details they already gave, in their original wording. Do not invent. Do not translate names.",
          inputSchema: z.object(fieldShape),
          execute: async (raw: Record<string, unknown>) => {
            const fields: LeadFields = {};
            for (const [key, value] of Object.entries(raw)) {
              if (typeof value === "string" && value.trim()) fields[key] = value.trim();
            }
            collected.fields = { ...collected.fields, ...fields };
            return "ok";
          },
        }),
        book_meeting: tool({
          description:
            "Record a tentative visit request after they agreed AND required booking fields are known. Do not claim it is confirmed.",
          inputSchema: z.object({ confirm: z.boolean() }),
          execute: async () => {
            if (stage.allowBook === false) return "booking disabled";
            collected.book = true;
            return "queued";
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
      },
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

  if (!collected.reply && !collected.escalate && !collected.book) {
    return heuristicTalk(ctx, stage);
  }

  collected.fields = phoneFieldsFromTurn(ctx, collected.fields ?? {});
  const merged = { ...ctx.lead.fields, ...collected.fields };
  const required = effectiveBookingRequired(ctx);
  const gaps = bookingFieldGaps(merged, required);
  const lang = replyLang(ctx, lastLeadText(ctx));
  const hours = venueHours(ctx);
  const deducedPhone =
    gaps[0] === "phone" && !savedPhone(merged) ? callbackPhone(ctx) : undefined;
  const finalized = finalizeTalkReply({
    reply: collected.reply,
    book: collected.book,
    lang,
    hours,
    gaps,
    lastAgentText: lastAgentText(ctx.messages),
    deducedPhone,
  });
  collected.reply = finalized.reply;
  collected.book = finalized.book;
  if (!collected.intent) {
    collected.intent = inferTalkIntent(
      lastLeadText(ctx),
      typeof merged.need === "string" ? merged.need : undefined,
    );
  }
  return collected;
}
