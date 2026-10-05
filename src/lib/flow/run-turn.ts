import { sendOnChannel } from "@/lib/channels/meta";
import {
  ensureChannelAccessToken,
  insertAgentMessage,
  loadTurnContext,
  pauseForHuman,
  persistStage,
  persistTurnFields,
} from "@/lib/conversations";
import {
  allCapabilitySessionFieldKeys,
  runCapabilityEffect,
} from "@/lib/flow/registry";
import {
  lastLeadMessageAt,
  resolveNudgeAfterDuration,
  resolveNudgeFireAt,
  resolvedNudgeSpec,
  shouldScheduleNudge,
} from "@/lib/flow/helpers";
import { interpretTurn } from "@/lib/flow/interpreter";
import { answerFaq, classifyIntent, draftQuestion, extractFields, talkTurn } from "@/lib/flow/llm";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { agentRepliesAllowed } from "@/lib/flow/agent-replies";
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
import { batchLeadRefreshes, safeRefreshLeadState } from "@/lib/crm/refresh";
import { addTurnPerf, runWithTurnPerf, timeAsync } from "@/lib/perf";

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
  const sendStarted = Date.now();
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
  const persistStarted = Date.now();
  // Token fetch overlaps message persist so loadTurnContext can skip accessTokenEnc.
  const [, accessToken] = await Promise.all([
    insertAgentMessage(ctx.tenantId, ctx.conversation.id, cleaned, {
      providerMessageId: opts?.idempotencyKey,
      leadId: ctx.lead.id,
    }),
    ensureChannelAccessToken(ctx.tenantId, ctx.connection),
  ]);
  addTurnPerf({ send_persist_ms: Date.now() - persistStarted });
  const httpStarted = Date.now();
  await sendOnChannel({
    apiBase: ctx.connection.apiBase,
    accessToken,
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
  addTurnPerf({ send_http_ms: Date.now() - httpStarted, send_ms: Date.now() - sendStarted });
  // Recompute lastOutboundAt / cold. Inside a turn this joins the turn's single refresh.
  await safeRefreshLeadState(ctx.tenantId, ctx.lead.id);
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
    /** Inbound message id this reminder was scheduled after (outbound idempotency). */
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
  const nudgeAt = resolveNudgeFireAt(anchorAt, after);
  if (!nudgeAt) return null;
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

/**
 * Send a nudge event recorded by the `scheduleNudge` port.
 * `runAgentTurn` does this through `step.sendEvent`; callers that invoke
 * `runTurnNow()` directly must call this or the nudge is silently dropped.
 */
export async function dispatchNudgeEvent(
  nudgeEvent: NudgeRequestedEvent | null | undefined,
): Promise<boolean> {
  if (!nudgeEvent) return false;
  await inngest.send(nudgeEvent);
  return true;
}

export async function enqueueAgentTurn(opts: {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  resume?: boolean;
  /** Epoch ms when the inbound was ready to turn (for queue_ms). */
  inboundAt?: number;
}) {
  await inngest.send({
    name: "agent/turn.requested",
    id: `turn-${opts.triggerMessageId}`,
    data: {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      resume: opts.resume,
      triggerMessageId: opts.triggerMessageId,
      inboundAt: opts.inboundAt ?? Date.now(),
    },
  });
}

/**
 * Local-dev routes (demo chat, dev inbound) run the turn themselves when Inngest is not
 * reachable. These wrappers report "not delivered" instead of throwing, so the route can
 * fall back to `runTurnNow()` rather than answer 500 with an empty body.
 */
export async function tryEnqueueAgentTurn(
  opts: Parameters<typeof enqueueAgentTurn>[0],
): Promise<boolean> {
  try {
    await enqueueAgentTurn(opts);
    return true;
  } catch (err) {
    console.warn(JSON.stringify({ msg: "inngest.unreachable", op: "enqueue_turn", error: String(err) }));
    return false;
  }
}

export async function tryDispatchNudgeEvent(
  nudgeEvent: NudgeRequestedEvent | null | undefined,
): Promise<boolean> {
  try {
    return await dispatchNudgeEvent(nudgeEvent);
  } catch (err) {
    console.warn(JSON.stringify({ msg: "inngest.unreachable", op: "nudge", error: String(err) }));
    return false;
  }
}

type RunTurnOpts = {
  tenantId: string;
  conversationId: string;
  resume?: boolean;
  triggerMessageId?: string;
  /** Epoch ms stamped at enqueue — worker start minus this is queue_ms. */
  inboundAt?: number;
};

export type SkippedTurnResult = {
  skipped: "missing_conversation" | "agent_replies_disabled";
  conversationId: string;
  stage: string;
  action: string;
  nudgeEvent: null;
};

/** One turn. Every CRM refresh the turn triggers collapses into one, after it ends. */
export async function runTurnNow(opts: RunTurnOpts) {
  const started = Date.now();
  const queue_ms =
    typeof opts.inboundAt === "number" && Number.isFinite(opts.inboundAt)
      ? started - opts.inboundAt
      : undefined;
  logTurn("enter", {
    tenantId: opts.tenantId,
    conversationId: opts.conversationId,
    triggerMessageId: opts.triggerMessageId,
    ...(queue_ms != null ? { queue_ms } : {}),
  });
  const { result, perf } = await runWithTurnPerf(async () =>
    batchLeadRefreshes(() => runTurn(opts)),
  );
  logTurn("exit", {
    tenantId: opts.tenantId,
    conversationId: result.conversationId ?? opts.conversationId,
    previousConversationId:
      "previousConversationId" in result ? result.previousConversationId : undefined,
    stage: result.stage,
    action: result.action,
    effects: "effects" in result ? result.effects : undefined,
    skipped: "skipped" in result ? result.skipped : undefined,
    ms: Date.now() - started,
    triggerMessageId: opts.triggerMessageId,
    ...(queue_ms != null ? { queue_ms } : {}),
    ...perf,
  });
  return result;
}

async function runTurn(opts: RunTurnOpts) {
  ensureFlowRegistry();
  let ctx: Awaited<ReturnType<typeof loadTurnContext>>;
  try {
    ctx = await loadTurnContext(opts.tenantId, opts.conversationId);
  } catch (err) {
    // Conversation deleted between enqueue and worker — same skip as the old load-context step.
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code === "P2025") {
      return {
        skipped: "missing_conversation",
        conversationId: opts.conversationId,
        stage: "",
        action: "",
        nudgeEvent: null,
      } satisfies SkippedTurnResult;
    }
    throw err;
  }

  if (!agentRepliesAllowed(ctx)) {
    return {
      skipped: "agent_replies_disabled",
      conversationId: opts.conversationId,
      stage: ctx.conversation.flowState,
      action: "agent_replies_disabled",
      nudgeEvent: null,
    } satisfies SkippedTurnResult;
  }

  const outboundKey = opts.triggerMessageId
    ? `out-${opts.conversationId}-${opts.triggerMessageId}`
    : undefined;

  let nudgeEvent: NudgeRequestedEvent | null = null;

  const { result, ms: interpret_ms } = await timeAsync(() =>
    interpretTurn(ctx, { resume: opts.resume }, {
      classify: async (c, stage) => {
        const { result: r, ms } = await timeAsync(() => classifyIntent(c, stage));
        addTurnPerf({ classify_ms: ms });
        return r;
      },
      extract: async (c, stage) => {
        const { result: r, ms } = await timeAsync(() => extractFields(c, stage));
        addTurnPerf({ extract_ms: ms });
        return r;
      },
      draftQuestion: async (c, stage, missing) => {
        const { result: r, ms } = await timeAsync(() => draftQuestion(c, stage, missing));
        addTurnPerf({ draft_ms: ms });
        return r;
      },
      answerFaq: async (c, stage) => {
        const { result: r, ms } = await timeAsync(() => answerFaq(c, stage));
        addTurnPerf({ faq_ms: ms });
        return r;
      },
      talk: async (c, stage) => {
        const { result: r, ms } = await timeAsync(() => talkTurn(c, stage));
        addTurnPerf({ talk_llm_ms: ms });
        return r;
      },
      runEffect: async (c, effectId, stage) => {
        const { result: r, ms } = await timeAsync(() => runCapabilityEffect(c, effectId, stage));
        addTurnPerf({ effect_ms: ms });
        return r;
      },
      requestHuman: async (c, reason) => {
        const { result: summary, ms: summarize_ms } = await timeAsync(() =>
          summarizeConversation(c.conversation.id),
        );
        addTurnPerf({ summarize_ms });
        const { ms: pause_ms } = await timeAsync(() =>
          pauseForHuman({
            tenantId: c.tenantId,
            conversationId: c.conversation.id,
            leadId: c.lead.id,
            reason,
            summary,
          }),
        );
        addTurnPerf({ effect_ms: pause_ms });
      },
      persistStage: async (c, stageId) => {
        const { ms } = await timeAsync(() => persistStage(c.tenantId, c.conversation.id, stageId));
        addTurnPerf({ persist_ms: ms });
      },
      persistFields: async (c, fields) => {
        const { ms } = await timeAsync(() =>
          persistTurnFields(c.tenantId, c.lead.id, c.conversation.id, fields, {
            extraSessionKeys: allCapabilitySessionFieldKeys(c),
          }),
        );
        addTurnPerf({ persist_ms: ms });
      },
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
    }),
  );
  addTurnPerf({ interpret_ms });

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
    await safeRefreshLeadState(opts.tenantId, ctx.lead.id);
    return {
      ...result,
      stage: ctx.agent.flow.start,
      nudgeEvent,
      conversationId: rotated.conversationId,
      previousConversationId: opts.conversationId,
    };
  }

  if (result.action === "done" || result.stage === "done") {
    await closeConversationAsDone({
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      reason: result.effects?.includes("accept_offered_slot") ? "approve" : "done",
    });
  }

  await safeRefreshLeadState(opts.tenantId, ctx.lead.id);
  return { ...result, nudgeEvent, conversationId: opts.conversationId };
}
