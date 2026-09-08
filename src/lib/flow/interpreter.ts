import { applyRestartPolicy, assertHitlAllowed, mergeAllowedFields, missingRequired } from "./helpers";
import { cannedIntroText, shouldSendCannedIntro } from "./intro";
import { copyFor, replyLang } from "@/lib/copy";
import type {
  ActionStage,
  CollectStage,
  FaqStage,
  LeadFields,
  Stage,
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
};

function hitlReasonKey(raw?: string): string {
  const t = (raw ?? "").trim();
  if (t === "support_unresolved" || t === "asked_for_person") return t;
  if (/unresolved|could not/i.test(t)) return "support_unresolved";
  return "asked_for_person";
}

async function sendWaitingHumanHold(ctx: TurnContext, ports: InterpreterPorts): Promise<void> {
  const lastLead = [...ctx.messages].reverse().find((m) => m.role === "lead")?.text ?? "";
  const lang = replyLang(ctx, lastLead);
  const hold = copyFor(lang).chat.waitingHumanHold;
  const lastAgent = [...ctx.messages].reverse().find((m) => m.role === "agent")?.text ?? "";
  if (lastAgent.trim() === hold) return;
  await ports.sendAndSave(ctx, hold);
}

export async function interpretTurn(
  ctx: TurnContext,
  event: TurnEvent,
  ports: InterpreterPorts,
): Promise<TurnResult> {
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

  const sendStaticIntro =
    !event.resume &&
    flow.stages[flow.start]?.type === "talk" &&
    shouldSendCannedIntro(ctx, { fromTerminal });

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
      const out = await ports.talk(ctx, stage);
      const schemaKeys = Object.keys(ctx.agent.leadSchema.fields);
      const incoming: LeadFields = { ...(out.fields ?? {}) };
      if (out.intent) incoming.intent = out.intent;
      ctx.lead.fields = mergeAllowedFields(schemaKeys, ctx.lead.fields, incoming);
      await ports.persistFields(ctx, ctx.lead.fields);

      // Static canned intro on first/idle turn — still extract above so the next
      // turn can continue from the customer's first message. Escalation keeps
      // the model reply instead of the welcome line.
      if (sendStaticIntro && !out.escalate) {
        out.reply = cannedIntroText(ctx);
        out.book = false;
        out.complete = false;
      }

      if (out.escalate) {
        assertHitlAllowed(ctx, stageId);
        const reason = hitlReasonKey(out.escalateReason);
        await ports.requestHuman(ctx, reason);
        await ports.sendAndSave(ctx, out.reply);
        ports.log("exit", { stageId: "waiting_human", stageType: "talk", escalate: true });
        return { stage: "waiting_human", action: "request_human", ok: true };
      }

      if (out.book && stage.allowBook !== false) {
        const booked = await ports.bookMeeting(ctx);
        await ports.sendAndSave(ctx, booked.reply);
        ports.log("exit", { stageId, action: "book_meeting", ok: booked.ok });
        return { stage: stageId, action: "book_meeting", ok: booked.ok };
      }

      if (out.complete) {
        await ports.sendAndSave(ctx, out.reply);
        await ports.persistStage(ctx, stage.on_complete);
        ctx.conversation.flowState = stage.on_complete;
        ports.log("exit", { stageId: stage.on_complete, stageType: "talk" });
        return { stage: stage.on_complete };
      }

      await ports.sendAndSave(ctx, out.reply);
      await ports.scheduleNudge(ctx, stageId, stage);
      ports.log("exit", { stageId, stageType: "talk", action: sendStaticIntro ? "canned_intro" : undefined });
      return { stage: stageId, action: sendStaticIntro ? "canned_intro" : undefined };
    }

    if (stage.type === "action") {
      const result = await runAction(ctx, stage, ports);
      const next = result.ok ? stage.on_complete : stage.on_fail;
      await ports.persistStage(ctx, next);
      ctx.conversation.flowState = next;
      await ports.sendAndSave(ctx, result.reply);
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
  assertHitlAllowed(ctx, ctx.conversation.flowState);
  await ports.requestHuman(ctx, "support_unresolved");
  return {
    ok: true,
    reply: "A person from the team will take this from here.",
  };
}
