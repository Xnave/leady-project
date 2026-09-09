import { sendOnChannel } from "@/lib/channels/meta";
import {
  insertAgentMessage,
  loadTurnContext,
  pauseForHuman,
  persistLeadFields,
  persistStage,
} from "@/lib/conversations";
import { requestTentativeMeeting } from "@/lib/meetings";
import { addIsoDuration } from "@/lib/flow/helpers";
import { interpretTurn } from "@/lib/flow/interpreter";
import { answerFaq, classifyIntent, draftQuestion, extractFields, talkTurn } from "@/lib/flow/llm";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { summarizeConversation } from "@/lib/flow/summarize";
import type { Stage, TurnContext } from "@/lib/flow/types";
import { inngest } from "@/inngest/client";

function logTurn(phase: "enter" | "exit", extra: Record<string, unknown>) {
  console.log(JSON.stringify({ msg: "runAgentTurn", phase, ...extra }));
}

export async function sendAndSave(
  ctx: Awaited<ReturnType<typeof loadTurnContext>>,
  text: string,
) {
  await insertAgentMessage(ctx.tenantId, ctx.conversation.id, text);
  await sendOnChannel({
    apiBase: ctx.connection.apiBase,
    accessToken: ctx.connection.accessToken,
    provider: ctx.connection.provider,
    providerAccountId: ctx.connection.providerAccountId,
    to: ctx.lead.externalUserId,
    text,
    zernioAccountId: ctx.connection.zernioAccountId,
    zernioConversationId:
      typeof ctx.lead.fields.zernioConversationId === "string"
        ? ctx.lead.fields.zernioConversationId
        : undefined,
  });
}

async function maybeScheduleNudge(ctx: TurnContext, stageId: string, stage: Stage) {
  if (!stage.nudge) return;
  const nudgeAt = addIsoDuration(new Date(), stage.nudge.after);
  await inngest.send({
    name: "agent/nudge.requested",
    id: `nudge-${ctx.conversation.id}-${stageId}-${ctx.agent.flowVersion}`,
    data: {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversation.id,
      expectedStage: stageId,
      nudgeAt: nudgeAt.toISOString(),
      template: stage.nudge.template,
      maxTimes: stage.nudge.maxTimes ?? 1,
      flowVersion: ctx.agent.flowVersion,
    },
  });
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
    },
  });
}

export async function runTurnNow(opts: {
  tenantId: string;
  conversationId: string;
  resume?: boolean;
}) {
  const ctx = await loadTurnContext(opts.tenantId, opts.conversationId);
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
    persistFields: (c, fields) => persistLeadFields(c.tenantId, c.lead.id, fields),
    sendAndSave: (c, text) =>
      sendAndSave(c as Awaited<ReturnType<typeof loadTurnContext>>, text),
    scheduleNudge: maybeScheduleNudge,
    log: logTurn,
  });

  if (result.action === "done" || result.stage === "done") {
    await closeConversationAsDone({
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
    });
  }

  return result;
}
