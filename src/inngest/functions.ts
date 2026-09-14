import { inngest } from "./client";
import { runTurnNow, sendAndSave, type NudgeRequestedEvent } from "@/lib/flow/run-turn";
import { loadTurnContext } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import type { FlowDefinition } from "@/lib/flow/types";

export const runAgentTurn = inngest.createFunction(
  {
    id: "run-agent-turn",
    retries: 3,
    concurrency: [{ key: "event.data.conversationId", limit: 1 }],
  },
  { event: "agent/turn.requested" },
  async ({ event, step }) => {
    const { tenantId, conversationId, resume, triggerMessageId } = event.data as {
      tenantId: string;
      conversationId: string;
      resume?: boolean;
      triggerMessageId?: string;
    };

    const loaded = await step.run("load-context", async () => {
      const convo = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: {
          id: true,
          flowState: true,
          status: true,
          flowVersion: true,
        },
      });
      return {
        found: Boolean(convo),
        flowState: convo?.flowState ?? null,
        status: convo?.status ?? null,
        flowVersion: convo?.flowVersion ?? null,
      };
    });

    if (!loaded.found) {
      return { skipped: "missing_conversation" };
    }

    const result = await step.run("interpret", () =>
      runTurnNow({
        tenantId,
        conversationId,
        resume,
        triggerMessageId,
      }),
    );

    const nudgeEvent = (result as { nudgeEvent?: NudgeRequestedEvent | null }).nudgeEvent;
    if (nudgeEvent) {
      await step.sendEvent("schedule-nudge", nudgeEvent);
    }

    return {
      ...result,
      preFlowState: loaded.flowState,
      preStatus: loaded.status,
      nudgeScheduled: Boolean(nudgeEvent),
    };
  },
);

export const nudgeIfSilent = inngest.createFunction(
  {
    id: "nudge-if-silent",
    cancelOn: [
      {
        event: "agent/turn.requested",
        if: "event.data.conversationId == async.data.conversationId && event.data.tenantId == async.data.tenantId && async.data.triggerMessageId != event.data.scheduledAfterMessageId",
        timeout: "30d",
      },
    ],
  },
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
      scheduledAfterMessageId?: string;
    };
    await step.sleepUntil("wait", new Date(data.nudgeAt));
    return step.run("maybe-send", async () => {
      const convo = await prisma.conversation.findFirst({
        where: { id: data.conversationId, tenantId: data.tenantId },
        include: { lead: true, channel: true, agent: true },
      });
      if (!convo) return { skipped: "missing" };
      if (convo.status !== "open") return { skipped: convo.status };
      const flow = convo.agent.flow as FlowDefinition;
      const expectedStage = flow.stages[data.expectedStage];
      if (!expectedStage || expectedStage.type === "terminal") {
        return { skipped: "terminal" };
      }
      const currentStage = flow.stages[convo.flowState];
      if (currentStage?.type === "terminal") return { skipped: "terminal" };
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
      const nudgeKey = `nudge-out-${data.conversationId}-${data.expectedStage}-${data.flowVersion ?? 0}-${counts[data.expectedStage] ?? 0}`;
      await sendAndSave(ctx, data.template, { idempotencyKey: nudgeKey });
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
