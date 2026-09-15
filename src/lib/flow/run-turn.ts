import { sendOnChannel } from "@/lib/channels/meta";
import {
  insertAgentMessage,
  loadTurnContext,
  pauseForHuman,
  persistStage,
  persistTurnFields,
} from "@/lib/conversations";
import { requestTentativeMeeting } from "@/lib/meetings";
import {
  addIsoDuration,
  lastLeadMessageAt,
  resolveNudgeAfterDuration,
  resolvedNudgeSpec,
  shouldScheduleNudge,
} from "@/lib/flow/helpers";
import { interpretTurn } from "@/lib/flow/interpreter";
import { answerFaq, classifyIntent, draftQuestion, extractFields, talkTurn } from "@/lib/flow/llm";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { callbackPhone, savedPhone } from "@/lib/flow/booking-collect";
import {
  closeConversationAsDone,
  rotateConversation,
} from "@/lib/flow/rotate-conversation";
import { summarizeConversation } from "@/lib/flow/summarize";
import type { Stage, TurnContext } from "@/lib/flow/types";
import { rewritePhonesInText } from "@/lib/leads";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/db";

function logTurn(phase: "enter" | "exit", extra: Record<string, unknown>) {
  console.log(JSON.stringify({ msg: "runAgentTurn", phase, ...extra }));
}

export async function sendAndSave(
  ctx: Awaited<ReturnType<typeof loadTurnContext>>,
  text: string,
  opts?: { idempotencyKey?: string },
) {
  if (!text.trim()) return;
  const cleaned = rewritePhonesInText(text, [
    savedPhone(ctx.lead.fields),
    callbackPhone(ctx),
    typeof ctx.lead.externalUserId === "string" ? ctx.lead.externalUserId : null,
  ]);
  if (opts?.idempotencyKey) {
    const existing = await prisma.message.findFirst({
      where: {
        tenantId: ctx.tenantId,
        conversationId: ctx.conversation.id,
        providerMessageId: opts.idempotencyKey,
      },
    });
    if (existing) return;
  }
  await insertAgentMessage(ctx.tenantId, ctx.conversation.id, cleaned, {
    providerMessageId: opts?.idempotencyKey,
  });
  await sendOnChannel({
    apiBase: ctx.connection.apiBase,
    accessToken: ctx.connection.accessToken,
    provider: ctx.connection.provider,
    providerAccountId: ctx.connection.providerAccountId,
    to: ctx.lead.externalUserId,
    text: cleaned,
    zernioAccountId: ctx.connection.zernioAccountId,
    zernioConversationId:
      typeof ctx.lead.fields.zernioConversationId === "string"
        ? ctx.lead.fields.zernioConversationId
        : undefined,
  });
}

export type NudgeRequestedEvent = {
  name: "agent/nudge.requested";
  id: string;
  data: {
    tenantId: string;
    conversationId: string;
    expectedStage: string;
    nudgeAt: string;
    template: string;
    flowVersion: number;
    /** Inbound message id for this turn; cancel only on a later turn.requested. */
    scheduledAfterMessageId: string;
    afterUsed: string;
    anchorLeadMessageAt: string;
  };
};

export function buildNudgeRequestedEvent(
  ctx: TurnContext,
  stageId: string,
  stage: Stage,
  triggerMessageId?: string,
): NudgeRequestedEvent | null {
  if (!shouldScheduleNudge(ctx, stageId, stage)) return null;
  if (!triggerMessageId) return null;
  const nudge = resolvedNudgeSpec(stage);
  if (!nudge) return null;
  const after = resolveNudgeAfterDuration(nudge.after);
  const anchorAt = lastLeadMessageAt(ctx.messages);
  const nudgeAt = addIsoDuration(anchorAt, after);
  return {
    name: "agent/nudge.requested",
    id: `nudge-${ctx.conversation.id}-${triggerMessageId}`,
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      expectedStage: stageId,
      nudgeAt: nudgeAt.toISOString(),
      template: nudge.template,
      flowVersion: ctx.agent.flowVersion,
      scheduledAfterMessageId: triggerMessageId,
      afterUsed: after,
      anchorLeadMessageAt: anchorAt.toISOString(),
    },
  };
}

export async function enqueueAgentTurn(opts: {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  resume?: boolean;
}) {
  await inngest.send({
    name: "agent/turn.requested",
    id: `turn-${opts.triggerMessageId}`,
    data: {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      resume: opts.resume,
      triggerMessageId: opts.triggerMessageId,
    },
  });
}

export async function runTurnNow(opts: {
  tenantId: string;
  conversationId: string;
  resume?: boolean;
  triggerMessageId?: string;
}) {
  ensureFlowRegistry();
  const started = Date.now();
  const ctx = await loadTurnContext(opts.tenantId, opts.conversationId);
  const outboundKey = opts.triggerMessageId
    ? `out-${opts.conversationId}-${opts.triggerMessageId}`
    : undefined;

  let nudgeEvent: NudgeRequestedEvent | null = null;

  const result = await interpretTurn(ctx, { resume: opts.resume }, {
    classify: classifyIntent,
    extract: extractFields,
    draftQuestion,
    answerFaq,
    talk: talkTurn,
    bookMeeting: (c) => requestTentativeMeeting(c),
    requestHuman: async (c, reason) => {
      const summary = await summarizeConversation(c.conversation.id);
      await pauseForHuman({
        tenantId: c.tenantId,
        conversationId: c.conversation.id,
        leadId: c.lead.id,
        reason,
        summary,
      });
    },
    persistStage: (c, stageId) => persistStage(c.tenantId, c.conversation.id, stageId),
    persistFields: (c, fields) =>
      persistTurnFields(c.tenantId, c.lead.id, c.conversation.id, fields),
    sendAndSave: (c, text) =>
      sendAndSave(c as Awaited<ReturnType<typeof loadTurnContext>>, text, {
        idempotencyKey: outboundKey
          ? `${outboundKey}-${Buffer.from(text).toString("base64url").slice(0, 24)}`
          : undefined,
      }),
    scheduleNudge: async (c, stageId, stage) => {
      nudgeEvent = buildNudgeRequestedEvent(c, stageId, stage, opts.triggerMessageId);
    },
    log: logTurn,
  });

  if (result.action === "start_new_conversation") {
    const intro = (result.reply ?? "").trim();
    const rotated = await rotateConversation({
      tenantId: opts.tenantId,
      leadId: ctx.lead.id,
      reason: "start_new_conversation",
      conversationId: opts.conversationId,
    });
    if (intro) {
      const fresh = await loadTurnContext(opts.tenantId, rotated.conversationId);
      await sendAndSave(fresh, intro, {
        idempotencyKey: outboundKey
          ? `${outboundKey}-new-${Buffer.from(intro).toString("base64url").slice(0, 24)}`
          : undefined,
      });
    }
    logTurn("exit", {
      tenantId: opts.tenantId,
      conversationId: rotated.conversationId,
      previousConversationId: opts.conversationId,
      stage: ctx.agent.flow.start,
      action: result.action,
      effects: result.effects,
      ms: Date.now() - started,
      triggerMessageId: opts.triggerMessageId,
    });
    return { ...result, stage: ctx.agent.flow.start, nudgeEvent };
  }

  if (result.action === "done" || result.stage === "done") {
    await closeConversationAsDone({
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      reason: result.effects?.includes("accept_offered_slot") ? "approve" : "done",
    });
  }

  logTurn("exit", {
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    stage: result.stage,
    action: result.action,
    effects: result.effects,
    ms: Date.now() - started,
    triggerMessageId: opts.triggerMessageId,
  });

  return { ...result, nudgeEvent };
}
