import { inngest } from "./client";
import { runTurnNow, sendAndSave, type NudgeRequestedEvent } from "@/lib/flow/run-turn";
import { loadTurnContext } from "@/lib/conversations";
import { draftNudgeReply } from "@/lib/flow/llm";
import { leadRepliedSinceAnchor } from "@/lib/flow/helpers";
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
    concurrency: [{ key: "event.data.conversationId", limit: 1 }],
    // `event` = incoming turn.requested; `async` = this nudge.requested.
    // Any new turn for the conversation cancels the pending reminder; that
    // turn will schedule a fresh one if the stage still wants it.
    cancelOn: [
      {
        event: "agent/turn.requested",
        if: "event.data.conversationId == async.data.conversationId && event.data.tenantId == async.data.tenantId",
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
      flowVersion?: number;
      scheduledAfterMessageId?: string;
      anchorLeadMessageAt?: string;
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
      const ctx = await loadTurnContext(data.tenantId, data.conversationId);
      const stage = flow.stages[data.expectedStage];
      if (!stage) return { skipped: "missing-stage" };
      if (
        data.anchorLeadMessageAt &&
        leadRepliedSinceAnchor(ctx.messages, data.anchorLeadMessageAt)
      ) {
        return { skipped: "replied" };
      }
      const text = await draftNudgeReply(ctx, stage, data.template);
      if (!text.trim()) return { skipped: "empty-nudge" };
      const anchor = data.scheduledAfterMessageId ?? "0";
      const nudgeKey = `nudge-out-${data.conversationId}-${data.expectedStage}-${anchor}`;
      await sendAndSave(ctx, text, { idempotencyKey: nudgeKey });
      return { sent: true };
    });
  },
);

export const crmDigest = inngest.createFunction(
  { id: "crm-digest", retries: 2 },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const { digestFeatureOn } = await import("@/lib/crm/flags");
    if (!digestFeatureOn()) return { skipped: "flag_off" };
    const { localDateAndHour } = await import("@/lib/crm/digest");
    // Memoized so replays (retries, step re-execution) see the same instant
    // instead of drifting to whatever wall-clock time the replay happens at.
    const nowIso = await step.run("now", () => new Date().toISOString());
    const now = new Date(nowIso);
    const tenants = await step.run("tenants", () =>
      prisma.tenant.findMany({ where: { digestEnabled: true }, select: { id: true, timezone: true, digestHour: true } }),
    );
    const due = tenants.filter((t) => localDateAndHour(now, t.timezone).hour === t.digestHour);
    for (const t of due) {
      await step.run(`digest-${t.id}`, async () => {
        const { runDigestForTenant } = await import("@/lib/crm/digest-send");
        return runDigestForTenant(t.id, now);
      });
    }
    return { tenants: due.length };
  },
);

export const inngestFunctions = [runAgentTurn, nudgeIfSilent, crmDigest];
