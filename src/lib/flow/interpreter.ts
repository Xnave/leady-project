import { applyRestartPolicy, assertHitlAllowed, mergeAllowedFields, missingRequired } from "./helpers";
import { ensureFlowRegistry } from "./capabilities";
import { getAction } from "./registry";
import { talkTransitionTargets } from "./prompt-builder";
import { copyFor, replyLang } from "@/lib/copy";
import type {
  ActionStage,
  CollectStage,
  FaqStage,
  LeadFields,
  Stage,
  TalkEffect,
  TalkOutcome,
  TalkStage,
  TurnContext,
} from "./types";

export type { TalkOutcome };

export type InterpreterPorts = {
  classify: (ctx: TurnContext, stage: Extract<Stage, { type: "classify" }>) => Promise<string>;
  extract: (ctx: TurnContext, stage: CollectStage) => Promise<LeadFields>;
  draftQuestion: (
    ctx: TurnContext,
    stage: CollectStage,
    missing: string[],
  ) => Promise<string>;
  answerFaq: (
    ctx: TurnContext,
    stage: FaqStage,
  ) => Promise<{ resolved: boolean; reply: string }>;
  talk: (ctx: TurnContext, stage: TalkStage) => Promise<TalkOutcome>;
  bookMeeting: (ctx: TurnContext) => Promise<{ ok: boolean; reply: string }>;
  requestHuman: (ctx: TurnContext, reason: string) => Promise<void>;
  persistStage: (ctx: TurnContext, stageId: string) => Promise<void>;
  persistFields: (ctx: TurnContext, fields: LeadFields) => Promise<void>;
  sendAndSave: (ctx: TurnContext, text: string) => Promise<void>;
  scheduleNudge: (ctx: TurnContext, stageId: string, stage: Stage) => Promise<void>;
  log: (phase: "enter" | "exit", extra: Record<string, unknown>) => void;
};

export type TurnEvent = {
  resume?: boolean;
};

export type TurnResult = {
  skipped?: string;
  stage: string;
  missing?: string[];
  action?: string;
  ok?: boolean;
  effects?: string[];
};

function hitlReasonKey(raw?: string): string {
  const t = (raw ?? "").trim();
  if (t === "support_unresolved") return t;
  if (t === "escalation_requested" || t === "asked_for_person") return "escalation_requested";
  if (/unresolved|could not/i.test(t)) return "support_unresolved";
  return "escalation_requested";
}

async function sendWaitingHumanHold(ctx: TurnContext, ports: InterpreterPorts): Promise<void> {
  const lastLead = [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
  const lang = replyLang(ctx, lastLead);
  const hold = copyFor(lang).chat.waitingHumanHold;
  const lastAgent = [...ctx.messages].reverse().find((m) => m.role === "agent")?.text ?? "";
  if (lastAgent.trim() === hold) return;
  await ports.sendAndSave(ctx, hold);
}

/** Map legacy TalkOutcome flags into nextStage + effects. */
export function normalizeTalkOutcome(out: TalkOutcome, stage: TalkStage): TalkOutcome {
  const effects: TalkEffect[] = [...(out.effects ?? [])];
  let nextStage = out.nextStage;
  const has = (type: string) => effects.some((e) => e.type === type);

  if (out.book && !has("book_meeting")) {
    effects.push({ type: "book_meeting" });
  }
  if (out.escalate && !has("request_human")) {
    effects.push({
      type: "request_human",
      args: { reason: out.escalateReason },
    });
  }
  if (out.acceptOfferedSlot && !has("accept_offered_slot")) {
    effects.push({ type: "accept_offered_slot" });
    nextStage = nextStage ?? stage.on_complete;
  }
  if (out.complete) {
    nextStage = nextStage ?? stage.on_complete;
  }
  if (has("request_human") && !nextStage) {
    nextStage = stage.on_escalate;
  }
  return { ...out, effects, nextStage };
}

function isAllowedTalkTransition(stage: TalkStage, next: string): boolean {
  return talkTransitionTargets(stage).includes(next);
}

export async function interpretTurn(
  ctx: TurnContext,
  event: TurnEvent,
  ports: InterpreterPorts,
): Promise<TurnResult> {
  ensureFlowRegistry();
  ports.log("enter", {
    tenantId: ctx.tenantId,
    conversationId: ctx.conversation.id,
    flowState: ctx.conversation.flowState,
    flowVersion: ctx.agent.flowVersion,
  });

  if (ctx.conversation.status === "waiting_human" && !event.resume) {
    await sendWaitingHumanHold(ctx, ports);
    ports.log("exit", { reason: "waiting_human" });
    return { skipped: "waiting_human", stage: ctx.conversation.flowState, action: "waiting_human_hold" };
  }

  const flow = ctx.agent.flow;
  let stageId = ctx.conversation.flowState || flow.start;
  let stage = flow.stages[stageId];
  if (!stage) {
    stageId = flow.start;
    stage = flow.stages[stageId];
    await ports.persistStage(ctx, stageId);
    ctx.conversation.flowState = stageId;
  }

  const fromTerminal =
    stage.type === "terminal" && (!event.resume || stageId === "waiting_human");
  if (fromTerminal) {
    const next = applyRestartPolicy(flow);
    const dest = next.kind === "ignore" ? flow.start : next.stageId;
    stageId = dest;
    stage = flow.stages[stageId];
    await ports.persistStage(ctx, stageId);
    ctx.conversation.flowState = stageId;
  }

  for (let hop = 0; hop < 8; hop += 1) {
    if (stage.type === "classify") {
      const intent = await ports.classify(ctx, stage);
      const next = stage.transitions[intent] ?? stage.transitions[stage.intents[0]];
      ctx.lead.fields = mergeAllowedFields(
        Object.keys(ctx.agent.leadSchema.fields),
        ctx.lead.fields,
        { intent },
      );
      await ports.persistFields(ctx, ctx.lead.fields);
      stageId = next;
      stage = flow.stages[stageId];
      await ports.persistStage(ctx, stageId);
      ctx.conversation.flowState = stageId;
      continue;
    }

    if (stage.type === "faq") {
      const faq = await ports.answerFaq(ctx, stage);
      const next = faq.resolved ? stage.on_resolved : stage.on_unresolved;
      await ports.persistStage(ctx, next);
      ctx.conversation.flowState = next;
      await ports.sendAndSave(ctx, faq.reply);
      if (next === "escalate" || flow.stages[next]?.type === "action") {
        stageId = next;
        stage = flow.stages[stageId];
        continue;
      }
      ports.log("exit", { stageId: next, stageType: flow.stages[next]?.type });
      return { stage: next };
    }

    if (stage.type === "collect") {
      const extracted = await ports.extract(ctx, stage);
      ctx.lead.fields = mergeAllowedFields(
        Object.keys(ctx.agent.leadSchema.fields),
        ctx.lead.fields,
        extracted,
      );
      await ports.persistFields(ctx, ctx.lead.fields);
      const missing = missingRequired(ctx.lead.fields, stage.required_fields);
      if (missing.length > 0) {
        const question = await ports.draftQuestion(ctx, stage, missing);
        await ports.sendAndSave(ctx, question);
        await ports.scheduleNudge(ctx, stageId, stage);
        ports.log("exit", { stageId, stageType: stage.type, missing });
        return { stage: stageId, missing };
      }
      stageId = stage.on_complete;
      stage = flow.stages[stageId];
      await ports.persistStage(ctx, stageId);
      ctx.conversation.flowState = stageId;
      continue;
    }

    if (stage.type === "talk") {
      const raw = await ports.talk(ctx, stage);
      const out = normalizeTalkOutcome(raw, stage);
      const schemaKeys = [
        ...Object.keys(ctx.agent.leadSchema.fields),
        "booking_confirm",
        "booking_flow",
        "staff_slot_offer",
      ];
      const incoming: LeadFields = { ...(out.fields ?? {}) };
      if (out.intent) incoming.intent = out.intent;
      ctx.lead.fields = mergeAllowedFields(schemaKeys, ctx.lead.fields, incoming);
      await ports.persistFields(ctx, ctx.lead.fields);

      const effectTypes = (out.effects ?? []).map((e) => e.type);
      let reply = out.reply;
      let bookedOk: boolean | undefined;
      let escalateReason = "";

      for (const effect of out.effects ?? []) {
        if (effect.type === "book_meeting") {
          if (stage.allowBook === false) continue;
          const booked = await ports.bookMeeting(ctx);
          reply = booked.reply;
          bookedOk = booked.ok;
          if (booked.ok) {
            await ports.persistStage(ctx, "waiting_human");
            ctx.conversation.flowState = "waiting_human";
            await ports.sendAndSave(ctx, reply);
            ports.log("exit", {
              stageId: "waiting_human",
              action: "book_meeting",
              ok: true,
              effects: effectTypes,
            });
            return {
              stage: "waiting_human",
              action: "book_meeting",
              ok: true,
              effects: effectTypes,
            };
          }
        }
        if (effect.type === "request_human") {
          escalateReason = hitlReasonKey(
            typeof effect.args?.reason === "string" ? effect.args.reason : undefined,
          );
        }
        if (effect.type === "accept_offered_slot") {
          // Meeting already approved inside the capability tool.
        }
      }

      if (bookedOk === false) {
        await ports.sendAndSave(ctx, reply);
        ports.log("exit", { stageId, action: "book_meeting", ok: false, effects: effectTypes });
        return { stage: stageId, action: "book_meeting", ok: false, effects: effectTypes };
      }

      let nextStage = out.nextStage;
      if (nextStage && !isAllowedTalkTransition(stage, nextStage)) {
        ports.log("exit", {
          stageId,
          action: "illegal_transition",
          nextStage,
          effects: effectTypes,
        });
        nextStage = undefined;
      }

      if (nextStage === stage.on_escalate || effectTypes.includes("request_human")) {
        assertHitlAllowed(ctx, stageId);
        const dest = stage.on_escalate;
        await ports.sendAndSave(ctx, reply);
        await ports.persistStage(ctx, dest);
        ctx.conversation.flowState = dest;
        stageId = dest;
        stage = flow.stages[stageId];
        // Continue into action stage; stash reason on fields for action hop.
        ctx.lead.fields = {
          ...ctx.lead.fields,
          _escalate_reason: escalateReason || "escalation_requested",
        };
        continue;
      }

      if (nextStage === stage.on_complete || effectTypes.includes("accept_offered_slot")) {
        await ports.sendAndSave(ctx, reply);
        await ports.persistStage(ctx, stage.on_complete);
        ctx.conversation.flowState = stage.on_complete;
        ports.log("exit", {
          stageId: stage.on_complete,
          action: effectTypes.includes("accept_offered_slot")
            ? "accept_offered_slot"
            : "done",
          effects: effectTypes,
        });
        return {
          stage: stage.on_complete,
          action: "done",
          ok: true,
          effects: effectTypes,
        };
      }

      await ports.sendAndSave(ctx, reply);
      await ports.scheduleNudge(ctx, stageId, stage);
      ports.log("exit", { stageId, stageType: "talk", effects: effectTypes });
      return { stage: stageId, effects: effectTypes };
    }

    if (stage.type === "action") {
      const result = await runAction(ctx, stage, ports);
      const next = result.ok ? stage.on_complete : stage.on_fail;
      await ports.persistStage(ctx, next);
      ctx.conversation.flowState = next;
      if (result.reply.trim()) {
        await ports.sendAndSave(ctx, result.reply);
      }
      ports.log("exit", { stageId: next, action: stage.action, ok: result.ok });
      return { stage: next, action: stage.action, ok: result.ok };
    }

    ports.log("exit", { stageId, stageType: stage.type });
    return { stage: stageId };
  }

  throw new Error("flow hop limit exceeded");
}

async function runAction(
  ctx: TurnContext,
  stage: ActionStage,
  ports: InterpreterPorts,
): Promise<{ ok: boolean; reply: string }> {
  if (stage.action === "book_meeting") {
    return ports.bookMeeting(ctx);
  }
  if (stage.action === "request_human") {
    assertHitlAllowed(ctx, ctx.conversation.flowState);
    const reason = hitlReasonKey(String(ctx.lead.fields._escalate_reason ?? "support_unresolved"));
    await ports.requestHuman(ctx, reason);
    // Talk already sent the customer-facing handoff line.
    if (ctx.lead.fields._escalate_reason) {
      return { ok: true, reply: "" };
    }
    return {
      ok: true,
      reply: "A person from the team will take this from here.",
    };
  }

  const registered = getAction(stage.action);
  if (registered) {
    return registered(ctx, stage);
  }
  return { ok: false, reply: `Unknown action: ${stage.action}` };
}
