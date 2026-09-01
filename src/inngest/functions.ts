import { inngest } from "./client";
import { sendAndSave } from "@/lib/flow/run-turn";
import { loadTurnContext, pauseForHuman, persistLeadFields, persistStage } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { interpretTurn } from "@/lib/flow/interpreter";
import { answerFaq, classifyIntent, draftQuestion, extractFields, talkTurn } from "@/lib/flow/llm";
import { requestTentativeMeeting } from "@/lib/meetings";
import { addIsoDuration } from "@/lib/flow/helpers";
import type { Stage, TurnContext } from "@/lib/flow/types";

function logTurn(phase: "enter" | "exit", extra: Record<string, unknown>) {
  console.log(JSON.stringify({ msg: "runAgentTurn", phase, ...extra }));
}

export const runAgentTurn = inngest.createFunction(
  {
    id: "run-agent-turn",
    retries: 3,
    concurrency: [{ key: "event.data.conversationId", limit: 1 }],
  },
  { event: "agent/turn.requested" },
  async ({ event, step }) => {
    const { tenantId, conversationId, resume } = event.data as {
      tenantId: string;
      conversationId: string;
      resume?: boolean;
    };

    const ctx = await step.run("load", () => loadTurnContext(tenantId, conversationId));

    return interpretTurn(ctx, { resume }, {
      classify: (c, stage) =>
        step.run(`classify:${stage.type}`, () => classifyIntent(c, stage)),
      extract: (c, stage) =>
        step.run(`extract:${c.conversation.flowState}`, () => extractFields(c, stage)),
      draftQuestion: (c, stage, missing) =>
        step.run(`next-question:${c.conversation.flowState}`, () =>
          draftQuestion(c, stage, missing),
        ),
      answerFaq: (c, stage) =>
        step.run(`faq:${c.conversation.flowState}`, () => answerFaq(c, stage)),
      talk: (c, stage) =>
        step.run(`talk:${c.conversation.flowState}`, () => talkTurn(c, stage)),
      bookMeeting: (c) =>
        step.run(`action:${c.conversation.flowState}:book_meeting`, () =>
          requestTentativeMeeting(c),
        ),
      requestHuman: async (c, reason) => {
        await step.run(`action:${c.conversation.flowState}:request_human`, () =>
          pauseForHuman({
            tenantId: c.tenantId,
            conversationId: c.conversation.id,
            leadId: c.lead.id,
            reason,
          }),
        );
      },
      persistStage: async (c, stageId) => {
        await step.run(`persist-stage:${stageId}`, () =>
          persistStage(c.tenantId, c.conversation.id, stageId),
        );
      },
      persistFields: async (c, fields) => {
        await step.run(`persist-fields:${c.conversation.flowState}`, () =>
          persistLeadFields(c.tenantId, c.lead.id, fields),
        );
      },
      sendAndSave: async (c, text) => {
        await step.run(`send:${c.conversation.flowState}`, () =>
          sendAndSave(c as Awaited<ReturnType<typeof loadTurnContext>>, text),
        );
      },
      scheduleNudge: async (c, stageId, stage) => {
        await step.run(`nudge:${stageId}`, () => maybeScheduleNudge(c, stageId, stage));
      },
      log: logTurn,
    });
  },
);

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

export const nudgeIfSilent = inngest.createFunction(
  { id: "nudge-if-silent" },
  { event: "agent/nudge.requested" },
  async ({ event, step }) => {
    const data = event.data as {
      tenantId: string;
      conversationId: string;
      expectedStage: string;
      nudgeAt: string;
      template: string;
      maxTimes: number;
      flowVersion?: number;
    };
    await step.sleepUntil("wait", new Date(data.nudgeAt));
    return step.run("maybe-send", async () => {
      const convo = await prisma.conversation.findFirst({
        where: { id: data.conversationId, tenantId: data.tenantId },
        include: { lead: true, channel: true, agent: true },
      });
      if (!convo) return { skipped: "missing" };
      if (convo.status === "waiting_human") return { skipped: "hitl" };
      if (convo.updatedAt > new Date(data.nudgeAt)) return { skipped: "replied" };
      if (convo.flowState !== data.expectedStage) return { skipped: "moved-on" };
      if (
        data.flowVersion != null &&
        convo.agent.flowVersion !== data.flowVersion
      ) {
        return { skipped: "stale-flow" };
      }
      const counts = (convo.nudgeCountByStage as Record<string, number>) ?? {};
      if ((counts[data.expectedStage] ?? 0) >= data.maxTimes) return { skipped: "max" };

      const ctx = await loadTurnContext(data.tenantId, data.conversationId);
      await sendAndSave(ctx, data.template);
      await prisma.conversation.update({
        where: { id: convo.id },
        data: {
          nudgeCountByStage: {
            ...counts,
            [data.expectedStage]: (counts[data.expectedStage] ?? 0) + 1,
          },
        },
      });
      return { sent: true };
    });
  },
);

export const inngestFunctions = [runAgentTurn, nudgeIfSilent];
