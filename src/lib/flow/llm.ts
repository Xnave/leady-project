import { generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { assignBareReply, isPushback, patternExtract } from "./extract";
import { missingRequired } from "./helpers";
import {
  conversationIntent,
  customerReadyToBook,
  extractKitchenService,
  inferKitchenKind,
  languageSystemRule,
  lastAgentText,
  nextSalesReply,
  resolveReplyLanguage,
} from "./locale";
import {
  askBookingField,
  askedNeedlessVenueQuestion,
  bookingFieldGaps,
  extractTimePreference,
  extractVisitKind,
} from "./booking";
import { rewriteForbiddenTalkReply, talkGuardrails } from "./guardrails";
import { cannedIntroText, hasAgentReplied } from "./intro";
import { chatModel, llmConfigured } from "./model";
import type { CollectStage, FaqStage, LeadFields, Stage, TalkOutcome, TalkStage, TurnContext } from "./types";

function lastLeadText(ctx: TurnContext): string {
  const last = [...ctx.messages].reverse().find((m) => m.role === "lead");
  return last?.text ?? "";
}

export async function classifyIntent(
  ctx: TurnContext,
  stage: Extract<Stage, { type: "classify" }>,
): Promise<string> {
  const blob = lastLeadText(ctx).toLowerCase();
  if (!llmConfigured()) {
    const supportHints = ["how", "reset", "broken", "help", "filter", "support"];
    if (supportHints.some((h) => blob.includes(h))) return "support";
    return stage.intents.includes("sales") ? "sales" : stage.intents[0];
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
  const blob = lastLeadText(ctx);
  const missing = missingRequired(ctx.lead.fields, stage.required_fields);
  const fromRules = {
    ...patternExtract(blob, keys),
    ...assignBareReply(
      blob,
      ctx.lead.fields,
      stage.required_fields,
      stage.optional_fields ?? [],
    ),
  };

  if (!llmConfigured()) return fromRules;

  try {
    const shape = Object.fromEntries(keys.map((k) => [k, z.string().optional()]));
    const { object } = await generateObject({
      model: chatModel(),
      schema: z.object(shape),
      system: `Extract fields the customer already stated. Do not invent.
If they answered with a short value (e.g. a first name), put it in "${missing[0] ?? keys[0]}".
Leave omitted fields undefined.`,
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
    return { ...fromRules, ...fromLlm };
  } catch (err) {
    console.error("extract fromLlm failed, using heuristic rules", err);
    return fromRules;
  }
}

export async function draftQuestion(
  ctx: TurnContext,
  stage: CollectStage,
  missing: string[],
): Promise<string> {
  const nextField = missing[0];
  const label = nextField.replaceAll("_", " ");
  const last = lastLeadText(ctx);
  if (!llmConfigured()) {
    if (isPushback(last) && !/^(hi|hello|hey|yo)[.!?]*$/i.test(last.trim())) {
      return `I only need a few details so we can book. What's your ${label}?`;
    }
    return `What's your ${label}?`;
  }
  const { text } = await generateText({
    model: chatModel(),
    system: `${stage.prompt}\n${ctx.agent.systemPrompt}
Ask only for: ${nextField}. One short message.
If they asked why, explain in one clause then ask for ${nextField}.`,
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
  if (!knowledge) {
    return { resolved: false, reply: "I do not have an answer in the knowledge base." };
  }
  // if (!llmConfigured()) {
  //   const hit = knowledge.toLowerCase().includes(question.toLowerCase().slice(0, 12));
  //   if (hit) return { resolved: true, reply: knowledge.slice(0, 280) };
  //   return {
  //     resolved: knowledge.length > 0 && question.length < 8,
  //     reply: knowledge.slice(0, 280),
  //   };
  // }
  const { text } = await generateText({
    model: chatModel(),
    system: `${stage.prompt}\nKnowledge:\n${knowledge}\nIf the knowledge does not answer, reply with exactly UNRESOLVED.`,
    prompt: question,
  });
  if (text.includes("UNRESOLVED")) {
    return { resolved: false, reply: "I will get a teammate to help with that." };
  }
  return { resolved: true, reply: text.trim() };
}

export { hasAgentReplied } from "./intro";

export function introGreeting(
  ctx: TurnContext,
  opts?: { askHowCanIHelp?: boolean },
): string {
  const last = lastLeadText(ctx);
  const lang = resolveReplyLanguage(ctx.tenant?.chatLanguage, last);
  const name = ctx.tenant?.name?.trim() || (lang === "he" ? "הצוות שלנו" : "our team");
  const fromPrompt = ctx.agent.systemPrompt
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !line.startsWith("You represent") &&
        !line.startsWith("Public phone") &&
        !line.startsWith("Always reply") &&
        !line.startsWith("Reply in"),
    );
  const intro = (ctx.tenant?.intro?.trim() || fromPrompt || "").replace(/\s+/g, " ");
  const ask = opts?.askHowCanIHelp !== false;
  const introAlreadyAsks = /במה אוכל לעזור|איך אפשר לעזור|how can i help/i.test(intro);

  if (lang === "he") {
    if (!intro) {
      return ask ? `היי, כאן ${name}. במה אוכל לעזור?` : `היי, כאן ${name}.`;
    }
    if (!ask) {
      return intro.replace(/\s*(במה אוכל לעזור\??|How can I help\??)\.?$/i, "").trim() || intro;
    }
    if (introAlreadyAsks) return intro;
    return `${intro.replace(/\.?$/, ".")} במה אוכל לעזור?`;
  }

  if (intro) {
    const clipped = intro.replace(/\.?$/, ".");
    if (!ask) return `Hi, we're ${name} — ${clipped}`;
    if (introAlreadyAsks) return `Hi, we're ${name} — ${clipped}`;
    return `Hi, we're ${name} — ${clipped} How can I help?`;
  }
  return ask ? `Hi, this is ${name}. How can I help?` : `Hi, this is ${name}.`;
}

export function heuristicTalk(ctx: TurnContext, stage: TalkStage): TalkOutcome {
  const last = lastLeadText(ctx);
  const lang = resolveReplyLanguage(ctx.tenant?.chatLanguage, last);
  const lastAgent = lastAgentText(ctx.messages);
  const schemaKeys = Object.keys(ctx.agent.leadSchema.fields).filter((k) => k !== "intent");
  const fields = {
    ...patternExtract(last, schemaKeys),
    ...extractKitchenService(last, lastAgent),
  };
  const mergedFields = { ...ctx.lead.fields, ...fields };
  const intent = conversationIntent(ctx.messages, last);
  const knowledge = ctx.agent.knowledgeText.trim();
  const kind = inferKitchenKind(ctx.messages, mergedFields);

  if (!hasAgentReplied(ctx)) {
    return { reply: cannedIntroText(ctx), fields, intent };
  }

  if (isPushback(last) && /why|למה/i.test(last)) {
    return {
      reply:
        lang === "he"
          ? "רק אם זה עוזר לי באמת לעזור — לביקור אצטרך שם וטלפון. במה אפשר לעזור עכשיו?"
          : "Only if it helps me actually help you — for a visit I would need a name and phone. What can I do for you right now?",
      fields,
      intent,
    };
  }

  if (stage.allowBook !== false && customerReadyToBook(ctx.messages)) {
    const when = extractTimePreference(last);
    if (when) fields.time_preference = when;
    const visit = extractVisitKind(last);
    if (visit) fields.visit_kind = visit;
    const merged = { ...mergedFields, ...fields };
    const gaps = bookingFieldGaps(merged);
    if (gaps.length === 0) {
      return {
        reply: lang === "he" ? "קולט את ההזמנה במערכת." : "Saving the visit request now.",
        fields,
        intent,
        book: true,
      };
    }
    return {
      reply: askBookingField(lang, gaps[0]),
      fields,
      intent,
    };
  }

  if (knowledge && intent === "support") {
    return { reply: knowledge.slice(0, 280), fields, intent };
  }

  if (intent === "sales") {
    return {
      reply: nextSalesReply(lang, { kind, lastCustomer: last, lastAgent }),
      fields,
      intent,
    };
  }

  if (intent === "support") {
    return {
      reply:
        lang === "he"
          ? "אשמח לעזור עם התקלה. מה בדיוק קורה?"
          : "I can help with that. What exactly is going wrong?",
      fields,
      intent,
    };
  }

  return {
    reply: lang === "he" ? "הבנתי. ספר לי עוד קצת." : "Got it. Tell me a bit more.",
    fields,
    intent,
  };
}

function talkSystem(ctx: TurnContext, stage: TalkStage): string {
  const intro = ctx.tenant?.intro?.trim() || "(no intro yet)";
  const name = ctx.tenant?.name ?? "this business";
  const last = lastLeadText(ctx);
  return [
    ctx.agent.systemPrompt,
    stage.prompt,
    talkGuardrails({ allowBook: stage.allowBook !== false }),
    languageSystemRule(ctx.tenant?.chatLanguage),
    `Business: ${name}`,
    `Canned intro already sent (do not repeat it): ${intro}`,
    `Knowledge:\n${ctx.agent.knowledgeText || "(none)"}`,
    `Known lead fields: ${JSON.stringify(ctx.lead.fields)}`,
    "Name and phone/email are contact details for a visit. They do not mean the visit is confirmed.",
    `Booking tool enabled: ${stage.allowBook !== false}. Use book_meeting after they agreed to a visit AND you have a time, name, and phone or email.`,
    "The greeting was a canned intro with no model. Read the full thread, including the message before the intro, to detect intent and continue.",
    "Continue the topic. Never repeat the intro or your last message. If they answered, even briefly, ask the next useful thing only.",
    "Detect intent from what they said (sales, support, or other).",
    "Do not ask for name or phone until they agreed to a visit. Then collect time, name, and phone — not whether they need the address.",
    "Do not call book_meeting unless they agreed to schedule a visit or measurement.",
    "Never say the appointment is confirmed. book_meeting only records a tentative request.",
    "Always call reply with the user-facing text in the correct language. Never reply in English if the conversation is Hebrew.",
    "If they push back (why?), explain then continue.",
    "Always call reply with the user-facing text.",
    `Latest customer message: ${last}`,
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
            "Record a tentative visit request after they agreed AND time + name + phone/email are known. Do not claim it is confirmed. Do not call this just because they sent an email.",
          inputSchema: z.object({ confirm: z.boolean() }),
          execute: async () => {
            if (stage.allowBook === false) return "booking disabled";
            if (!customerReadyToBook(ctx.messages)) {
              return "customer has not asked to schedule — continue the conversation, do not book";
            }
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

  if (!customerReadyToBook(ctx.messages)) {
    collected.book = false;
    if (/Booked for|calendar invite/i.test(collected.reply)) {
      collected.reply = "";
    }
  }

  if (!collected.reply) {
    return heuristicTalk(ctx, stage);
  }

  const lang = resolveReplyLanguage(ctx.tenant?.chatLanguage, lastLeadText(ctx));
  collected.reply = rewriteForbiddenTalkReply(collected.reply, lang);

  const last = lastLeadText(ctx);
  const when = extractTimePreference(last);
  const visit = extractVisitKind(last);
  if (when || visit) {
    collected.fields = {
      ...collected.fields,
      ...(when ? { time_preference: when } : {}),
      ...(visit ? { visit_kind: visit } : {}),
    };
  }
  const merged = { ...ctx.lead.fields, ...collected.fields };
  const gaps = bookingFieldGaps(merged);
  if (customerReadyToBook(ctx.messages)) {
    if (gaps.length === 0) {
      collected.book = true;
    } else {
      collected.book = false;
      if (
        askedNeedlessVenueQuestion(collected.reply) ||
        /חכה לי|see you|מחכים לך|I'll (?:put|write) you/i.test(collected.reply)
      ) {
        collected.reply = askBookingField(lang, gaps[0]);
      }
    }
  }

  return collected;
}

