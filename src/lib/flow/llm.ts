import { generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { copyFor, replyLang } from "@/lib/copy";
import { missingRequired } from "./helpers";
import { askBookingField, bookingFieldGaps } from "./booking";
import { bookingRequiredFields, withKnownPhone } from "./booking-collect";
import { talkGuardrails } from "./guardrails";
import { cannedIntroText, hasAgentReplied } from "./intro";
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
  const fields = withKnownPhone(ctx, {});
  const required = bookingRequiredFields(ctx);

  if (!hasAgentReplied(ctx)) {
    return { reply: cannedIntroText(ctx), fields };
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
  const required = bookingRequiredFields(ctx);
  const phone = String(withKnownPhone(ctx, {}).phone ?? "");
  const whatsapp = ctx.channel?.provider === "whatsapp";
  const channelLine = whatsapp
    ? `Channel: WhatsApp for this tenant. Callback phone already on this lead: ${phone || "(none)"}. Do not ask for it unless they want a different number.`
    : `Channel: ${ctx.channel?.provider ?? "chat"}.`;
  return [
    ctx.agent.systemPrompt,
    stage.prompt,
    talkGuardrails({
      allowBook: stage.allowBook !== false,
      requiredForBook: required,
      hours,
      whatsappPhone: whatsapp ? phone || undefined : undefined,
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
  if (!hasAgentReplied(ctx)) {
    return { reply: cannedIntroText(ctx) };
  }
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
          description: "What they want: sales (buy/book/quote), support, or other.",
          inputSchema: z.object({ intent: z.enum(["sales", "support", "other"]) }),
          execute: async ({ intent }: { intent: "sales" | "support" | "other" }) => {
            collected.intent = intent;
            return "ok";
          },
        }),
        save_fields: tool({
          description: "Save details they already gave. Do not invent.",
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
          execute: async () => {
            collected.escalate = true;
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

  if (!collected.reply) {
    return heuristicTalk(ctx, stage);
  }

  collected.fields = withKnownPhone(ctx, collected.fields ?? {});
  const merged = { ...ctx.lead.fields, ...collected.fields };
  const required = bookingRequiredFields(ctx);
  const gaps = bookingFieldGaps(merged, required);
  const lang = replyLang(ctx, lastLeadText(ctx));
  const hours = venueHours(ctx);
  if (collected.book) {
    if (gaps.length > 0) {
      collected.book = false;
      collected.reply = askBookingField(lang, gaps[0], { hours });
    }
  } else if (hours && collected.reply.includes("?") && !collected.reply.includes(hours)) {
    const askingTime = required.includes("time_preference") && !String(merged.time_preference ?? "").trim();
    if (askingTime) {
      collected.reply = `${collected.reply.trim()}\n${copyFor(lang).chat.hoursLine(hours)}`;
    }
  }

  return collected;
}
