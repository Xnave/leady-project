import { copyFor, replyLang } from "@/lib/copy";
import { talkGuardrails } from "./guardrails";
import { hasAgentReplied } from "./intro";
import { capabilityPromptSections, resolveTalkCapabilities } from "./registry";
import type { LeadFields, Stage, TalkStage, TurnContext } from "./types";
import { getStaffSlotOffer } from "@/lib/meetings";
import { bookingConfirmStatus, bookingFieldGaps, isBookingCollectActive } from "./booking";
import {
  callbackPhone,
  effectiveBookingRequired,
  savedPhone,
} from "./booking-collect";

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
        this.parts.push(`Channel: WhatsApp. Callback phone already saved: ${saved}.`);
      } else if (deduced) {
        this.parts.push(
          `Channel: WhatsApp. Deduced callback candidate: ${deduced}. Confirm with the customer before save_fields phone=${deduced}.`,
        );
      } else {
        this.parts.push(
          "Channel: WhatsApp. No callback number yet — ask_field phone when phone is required for booking.",
        );
      }
    } else {
      this.parts.push(`Channel: ${ctx.channel?.provider ?? "chat"}.`);
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
    const offered = getStaffSlotOffer(fields);
    if (offered) {
      this.parts.push(
        [
          `A teammate offered an alternative visit slot and is waiting on the customer: "${offered.slot}" (previous was "${offered.previousSlot || "n/a"}").`,
          "Call resolve_offered_slot with your decision:",
          '- decision="accept" ONLY if they clearly agree to THAT exact offered slot with no other day or time named.',
          '- decision="decline" if they reject it or name any other slot (pass proposed_slot).',
          '- decision="unclear" if you cannot tell.',
          "Never treat a fresh booking request as accept of the staff offer.",
          "Do NOT call ask_field, book_meeting, or confirm_details while this offer is pending.",
        ].join("\n"),
      );
      return this;
    }
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
    if (resolveTalkCapabilities(stage).includes("booking")) {
      const active = isBookingCollectActive(fields, required);
      if (active) {
        const gaps = bookingFieldGaps(fields, required);
        const confirm = bookingConfirmStatus(fields);
        this.parts.push(
          `Visit booking is in progress. Gaps: ${gaps.join(", ") || "none"}. booking_confirm=${confirm || "(none)"}.`,
          "When they answer a booking question, call save_fields with their wording first, then ask_field for the next gap only.",
          "time_preference: weekday + clock is enough — save as-is.",
          "Before book_meeting: confirm_details, then save_fields booking_confirm=confirmed after they agree, then book_meeting.",
        );
      } else {
        this.parts.push(
          "Visit booking is NOT started. Use reply to answer product/sales questions from knowledge.",
          'Examples that must NOT trigger booking: "I want a WhatsApp agent", "how much is it", "tell me more", "I need something for Instagram".',
          "Only call start_booking if they explicitly ask to schedule a meeting/visit/demo/call, or clearly accept an offer to book.",
        );
      }
    }
    return this;
  }

  withClosing(): this {
    this.parts.push(
      "Call set_intent every turn.",
      "Prefer reply for informational turns. Call ask_field only while booking is in progress.",
      "Call reply unless ask_field or resolve_offered_slot already set the outbound text.",
      "Use transition when the goal is complete (on_complete) or you must hand off (on_escalate).",
    );
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
    .withClosing()
    .build();
}
