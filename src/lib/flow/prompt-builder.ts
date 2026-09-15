import { copyFor, replyLang } from "@/lib/copy";
import { talkGuardrails } from "./guardrails";
import { hasAgentReplied, isIdleConversationReset } from "./intro";
import { capabilityClosingLines, capabilityPromptSections, resolveTalkCapabilities } from "./registry";
import type { LeadFields, Stage, TalkStage, TurnContext } from "./types";
import {
  callbackPhone,
  effectiveBookingRequired,
  savedPhone,
} from "./booking-collect";
import { formatPhoneDisplay } from "@/lib/leads";

function lastLeadText(ctx: TurnContext): string {
  return [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
}

/** Allowed transition targets from a talk stage (graph edges). */
export function talkTransitionTargets(stage: TalkStage): string[] {
  return [stage.on_complete, stage.on_escalate].filter(Boolean);
}

/**
 * Builds the system prompt for a turn from agent + stage + capabilities + context.
 * Single extension point for new capability prompt sections.
 */
export class PromptBuilder {
  private parts: string[] = [];

  withBase(ctx: TurnContext, lang: "en" | "he"): this {
    this.parts.push(ctx.agent.systemPrompt);
    const intro = ctx.tenant?.intro?.trim() || "";
    if (!hasAgentReplied(ctx)) {
      this.parts.push(
        lang === "he"
          ? `FIRST MESSAGE: Greet using this business intro (do not invent a different welcome): ${intro || "(short hello)"}. Then address their message.`
          : `FIRST MESSAGE: Greet using this business intro (do not invent a different welcome): ${intro || "(short hello)"}. Then address their message.`,
      );
    }
    return this;
  }

  withStage(stage: Stage): this {
    if ("prompt" in stage && typeof stage.prompt === "string" && stage.prompt.trim()) {
      this.parts.push(stage.prompt);
    }
    if (stage.type === "talk") {
      const targets = talkTransitionTargets(stage).join(", ");
      this.parts.push(
        `Current state: talk. Allowed transition targets via transition tool: ${targets || "(none)"}.`,
        "Never tell the customer a visit/meeting is confirmed with the business until a teammate has approved it.",
      );
    }
    return this;
  }

  withChannel(ctx: TurnContext, fields: LeadFields): this {
    const whatsapp = ctx.channel?.provider === "whatsapp";
    const saved = savedPhone(fields);
    const deduced = callbackPhone(ctx) ?? "";
    if (whatsapp) {
      if (saved) {
        this.parts.push(
          `Channel: WhatsApp. Callback phone already saved: ${saved}. When mentioning it to the customer, write it as ${formatPhoneDisplay(saved) || saved} (never +972…).`,
        );
      } else if (deduced) {
        this.parts.push(
          `Channel: WhatsApp. Deduced callback candidate: ${deduced} (display as ${formatPhoneDisplay(deduced) || deduced}). Confirm with the customer before save_fields phone=${deduced}.`,
        );
      } else {
        this.parts.push(
          "Channel: WhatsApp. No callback number yet — ask_field phone when phone is required for booking.",
        );
      }
    } else {
      this.parts.push(`Channel: ${ctx.channel?.provider ?? "chat"}.`);
      if (saved) {
        this.parts.push(
          `When mentioning their phone, use ${formatPhoneDisplay(saved) || saved} (never international +972 form).`,
        );
      }
    }
    return this;
  }

  withGuardrails(ctx: TurnContext, stage: TalkStage, lang: "en" | "he"): this {
    const required = effectiveBookingRequired(ctx);
    const saved = savedPhone(ctx.lead.fields);
    const deduced = callbackPhone(ctx);
    this.parts.push(
      talkGuardrails({
        allowBook:
          stage.allowBook !== false &&
          resolveTalkCapabilities(stage).includes("booking"),
        requiredForBook: required,
        hours: ctx.tenant?.venueHours?.trim() ?? "",
        whatsappPhone: !saved && deduced ? deduced : undefined,
        lang,
      }),
    );
    return this;
  }

  withCapabilities(ctx: TurnContext, stage: TalkStage, fields: LeadFields): this {
    this.parts.push(...capabilityPromptSections({ ctx, stage, fields }));
    return this;
  }

  withTalkContext(ctx: TurnContext, stage: TalkStage, fields: LeadFields, lang: "en" | "he"): this {
    const last = lastLeadText(ctx);
    const required = effectiveBookingRequired(ctx);
    this.parts.push(
      copyFor(lang).prompts.talkContext({
        business: ctx.tenant?.name ?? "this business",
        intro: ctx.tenant?.intro?.trim() || "(no intro yet)",
        knowledge: ctx.agent.knowledgeText,
        fieldsJson: JSON.stringify(fields),
        channelLine: "",
        requiredFields: required.join(", "),
        hours: ctx.tenant?.venueHours?.trim() ?? "",
        address: ctx.tenant?.venueAddress?.trim() ?? "",
        last,
      }),
    );
    if (isIdleConversationReset(ctx)) {
      this.parts.push(
        "There was a long gap since the previous message. Continue in this same conversation by default. If a clean start seems better, ask whether they want a new conversation — only call start_new_conversation after they clearly agree.",
      );
    }
    return this;
  }

  withNudgeInstruction(instruction: string, lang: "en" | "he"): this {
    const hint =
      instruction.trim() || copyFor(lang).prompts.nudgeDefaultInstruction;
    this.parts.push(
      "IGNORE tool instructions above (reply, set_intent, ask_field, etc.) — this turn is plain text generation only.",
      copyFor(lang).prompts.nudgeTurn(hint),
    );
    return this;
  }

  withClosing(stage?: TalkStage): this {
    this.parts.push(
      "Call set_intent every turn.",
      "Call reply unless a tool already set the outbound text.",
      "Use transition when the goal is complete (on_complete) or you must hand off (on_escalate).",
      "Conversation continuity: keep the SAME thread for follow-ups. Never invent a fresh welcome mid-thread.",
      "Only if the topic is clearly a brand-new matter AND a long gap / customer wants a clean start: first ask with reply whether to open a new conversation. Call start_new_conversation(intro=...) ONLY after they clearly say yes — the intro becomes the first message on the new thread.",
    );
    if (stage) {
      this.parts.push(...capabilityClosingLines(stage));
    }
    return this;
  }

  build(): string {
    return this.parts.filter((p) => p.trim()).join("\n");
  }
}

export function buildTalkSystemPrompt(
  ctx: TurnContext,
  stage: TalkStage,
  fields: LeadFields = ctx.lead.fields,
): string {
  const lang = replyLang(ctx, lastLeadText(ctx));
  return new PromptBuilder()
    .withBase(ctx, lang)
    .withStage(stage)
    .withGuardrails(ctx, stage, lang)
    .withChannel(ctx, fields)
    .withTalkContext(ctx, stage, fields, lang)
    .withCapabilities(ctx, stage, fields)
    .withClosing(stage)
    .build();
}

/** Same business context as talk, but single-message nudge mode (no tools). */
export function buildNudgeSystemPrompt(
  ctx: TurnContext,
  stage: Stage,
  instruction: string,
  fields: LeadFields = ctx.lead.fields,
): string {
  const lang = replyLang(ctx, lastLeadText(ctx));
  const builder = new PromptBuilder().withBase(ctx, lang).withStage(stage);

  if (stage.type === "talk") {
    builder
      .withGuardrails(ctx, stage, lang)
      .withChannel(ctx, fields)
      .withTalkContext(ctx, stage, fields, lang)
      .withCapabilities(ctx, stage, fields);
  } else {
    builder.withChannel(ctx, fields);
  }

  return builder.withNudgeInstruction(instruction, lang).build();
}
