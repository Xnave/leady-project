import { generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { copyFor, replyLang } from "@/lib/copy";
import { missingRequired } from "./helpers";
import { askBookingField } from "./booking";
import { callbackPhone, effectiveBookingRequired } from "./booking-collect";
import { ensureFlowRegistry } from "./capabilities";
import { getCapability, resolveTalkCapabilities } from "./registry";
import { buildTalkSystemPrompt, talkTransitionTargets } from "./prompt-builder";
import { hasAgentReplied, cannedIntroText } from "./intro";
import { chatModel, llmConfigured } from "./model";
import type {
  CollectStage,
  FaqStage,
  LeadFields,
  Stage,
  TalkOutcome,
  TalkStage,
  TurnContext,
} from "./types";
import type { TalkCollected } from "./capabilities/booking";
import { getStaffSlotOffer } from "@/lib/meetings";

function lastLeadText(ctx: TurnContext): string {
  const last = [...ctx.messages].reverse().find((m) => m.role === "lead");
  return last?.text ?? "";
}

function venueHours(ctx: TurnContext): string {
  return ctx.tenant?.venueHours?.trim() ?? "";
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
  if (!llmConfigured()) {
    return { resolved: false, reply: chat.faqUnresolved };
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

/**
 * Safe degrade when the LLM is unavailable — never invent booking decisions.
 */
export function degradeTalk(ctx: TurnContext, _stage: TalkStage): TalkOutcome {
  const last = lastLeadText(ctx);
  const lang = replyLang(ctx, last);
  const chat = copyFor(lang).chat;
  if (!hasAgentReplied(ctx)) {
    // Presentation-only fallback when LLM is down — not dialogue policy.
    return { reply: cannedIntroText(ctx) };
  }
  return {
    reply: chat.waitingHumanHold,
    effects: [{ type: "request_human", args: { reason: "llm_unavailable" } }],
    nextStage: _stage.on_escalate,
  };
}

/** @deprecated Use degradeTalk — kept for preview/tests name stability. */
export function heuristicTalk(ctx: TurnContext, stage: TalkStage): TalkOutcome {
  return degradeTalk(ctx, stage);
}

export async function talkTurn(ctx: TurnContext, stage: TalkStage): Promise<TalkOutcome> {
  ensureFlowRegistry();

  if (!llmConfigured()) {
    return degradeTalk(ctx, stage);
  }

  const fieldsForTurn = { ...ctx.lead.fields };
  const offered = getStaffSlotOffer(fieldsForTurn);
  const collected: TalkCollected = {
    reply: "",
    fields: {},
    effects: [],
  };

  const allowedTransitions = talkTransitionTargets(stage);

  const baseTools = {
    reply: tool({
      description:
        "User-facing message. Call once unless ask_field or resolve_offered_slot already set the outbound text.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }: { text: string }) => {
        if (!collected.replyLocked) {
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
    transition: tool({
      description: `Move to a legal next stage. Allowed: ${allowedTransitions.join(", ") || "none"}.`,
      inputSchema: z.object({
        stage: z.string(),
        reason: z.string().optional(),
      }),
      execute: async ({ stage: dest }: { stage: string; reason?: string }) => {
        if (!allowedTransitions.includes(dest)) {
          return JSON.stringify({
            ok: false,
            error: "illegal_transition",
            allowed: allowedTransitions,
          });
        }
        collected.nextStage = dest;
        if (dest === stage.on_escalate) {
          collected.effects = [
            ...(collected.effects ?? []),
            { type: "request_human", args: { reason: "escalation_requested" } },
          ];
        }
        return JSON.stringify({ ok: true, stage: dest });
      },
    }),
    request_human: tool({
      description: "Hand off to a person when policy allows (transitions to on_escalate).",
      inputSchema: z.object({ reason: z.string() }),
      execute: async ({ reason }: { reason: string }) => {
        collected.effects = [
          ...(collected.effects ?? []),
          {
            type: "request_human",
            args: { reason: reason.trim() || "escalation_requested" },
          },
        ];
        collected.nextStage = stage.on_escalate;
        return "queued";
      },
    }),
  };

  const capabilityTools: Record<string, unknown> = {};
  if (offered) {
    const booking = getCapability("booking");
    if (booking?.tools) {
      Object.assign(
        capabilityTools,
        booking.tools({ ctx, stage, collected }),
      );
    }
  } else {
    for (const id of resolveTalkCapabilities(stage)) {
      const cap = getCapability(id);
      if (cap?.tools) {
        Object.assign(capabilityTools, cap.tools({ ctx, stage, collected }));
      }
    }
  }

  try {
    const result = await generateText({
      model: chatModel(),
      system: buildTalkSystemPrompt(ctx, stage, fieldsForTurn),
      prompt: ctx.messages
        .slice(-12)
        .map((m) => `${m.role}: ${m.text}`)
        .join("\n"),
      tools: { ...baseTools, ...capabilityTools } as Parameters<
        typeof generateText
      >[0]["tools"],
      stopWhen: stepCountIs(8),
      maxRetries: 2,
    });

    if (!collected.reply && result.text?.trim()) {
      collected.reply = result.text.trim();
    }
  } catch (err) {
    console.error("talkTurn LLM failed, degrading", err);
    return degradeTalk(ctx, stage);
  }

  if (
    !collected.reply &&
    !(collected.effects?.length) &&
    !collected.nextStage
  ) {
    return degradeTalk(ctx, stage);
  }

  return collected;
}
