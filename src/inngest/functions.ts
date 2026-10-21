import { inngest } from "./client";
import { runTurnNow, sendAndSave, type NudgeRequestedEvent } from "@/lib/flow/run-turn";
import { loadTurnContext } from "@/lib/conversations";
import { agentRepliesAllowed } from "@/lib/flow/agent-replies";
import { draftNudgeReply } from "@/lib/flow/llm";
import { leadRepliedSinceAnchor } from "@/lib/flow/helpers";
import { prisma } from "@/lib/db";
import { RAPID_DEMO_CLERK_ORG_PREFIX } from "@/lib/rapid-demo/guards";
import type { FlowDefinition } from "@/lib/flow/types";
import type { OwnerAlertEvent } from "@/lib/crm/alerts-send";

export const runAgentTurn = inngest.createFunction(
  {
    id: "run-agent-turn",
    retries: 3,
    concurrency: [{ key: "event.data.conversationId", limit: 1 }],
  },
  { event: "agent/turn.requested" },
  async ({ event, step }) => {
    const { tenantId, conversationId, resume, triggerMessageId, inboundAt } = event.data as {
      tenantId: string;
      conversationId: string;
      resume?: boolean;
      triggerMessageId?: string;
      inboundAt?: number;
    };

    // Single durable step - missing convo is skipped inside runTurnNow (no extra load-context).
    const result = await step.run("interpret", async () => {
      const interpretStarted = Date.now();
      const turn = await runTurnNow({
        tenantId,
        conversationId,
        resume,
        triggerMessageId,
        inboundAt,
      });
      console.log(
        JSON.stringify({
          msg: "inngest.turn",
          tenantId,
          conversationId,
          interpret_ms: Date.now() - interpretStarted,
          stage: turn.stage,
          action: turn.action,
          skipped: "skipped" in turn ? turn.skipped : undefined,
        }),
      );
      return turn;
    });

    if ("skipped" in result && result.skipped === "missing_conversation") {
      return { skipped: "missing_conversation" };
    }

    const nudgeEvent = (result as { nudgeEvent?: NudgeRequestedEvent | null }).nudgeEvent;
    if (nudgeEvent) {
      await step.sendEvent("schedule-nudge", nudgeEvent);
    }

    const ownerAlertEvents = (result as { ownerAlertEvents?: OwnerAlertEvent[] }).ownerAlertEvents ?? [];
    if (ownerAlertEvents.length) {
      await step.sendEvent("owner-alerts", ownerAlertEvents);
    }

    return {
      ...result,
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
      if (!agentRepliesAllowed(ctx)) return { skipped: "agent_replies_disabled" };
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
      prisma.tenant.findMany({
        where: {
          digestEnabled: true,
          NOT: { clerkOrgId: { startsWith: RAPID_DEMO_CLERK_ORG_PREFIX } },
        },
        select: { id: true, timezone: true, digestHour: true },
      }),
    );
    const due = tenants.filter((t) => localDateAndHour(now, t.timezone).hour === t.digestHour);
    if (due.length === 0) return { tenants: 0 };
    // One Meta lookup per run, shared by every tenant due this hour.
    const approved = await step.run("approved-templates", async () => {
      const { loadApprovedDigestTemplates } = await import("@/lib/crm/digest-send");
      return loadApprovedDigestTemplates();
    });
    for (const t of due) {
      await step.run(`digest-${t.id}`, async () => {
        const { runDigestForTenant } = await import("@/lib/crm/digest-send");
        return runDigestForTenant(t.id, now, new Set(approved));
      });
    }
    return { tenants: due.length };
  },
);

/**
 * Instant WhatsApp alert to the owner for one approval or handoff task. In
 * off hours with "hold", it sleeps until they end; recipients are re-read
 * after the wait, so a task handled in the meantime sends nothing. One step
 * per recipient, so a retry never re-sends to whoever already got it.
 */
export const ownerAlert = inngest.createFunction(
  { id: "owner-alert", retries: 2 },
  { event: "crm/owner-alert.requested" },
  async ({ event, step }) => {
    const { tenantId, taskId } = event.data as OwnerAlertEvent["data"];
    const nowIso = await step.run("now", () => new Date().toISOString());
    const plan = await step.run("plan", async () => {
      const { planOwnerAlert } = await import("@/lib/crm/alerts-send");
      return planOwnerAlert(tenantId, taskId, new Date(nowIso));
    });
    if (!plan.send) return { skipped: plan.reason };
    if (new Date(plan.at).getTime() > new Date(nowIso).getTime()) {
      await step.sleepUntil("off-hours", plan.at);
    }
    const recipients = await step.run("recipients", async () => {
      const { ownerAlertRecipients } = await import("@/lib/crm/alerts-send");
      return ownerAlertRecipients(tenantId, taskId);
    });
    if (recipients.length === 0) return { recipients: 0, sent: {} };
    // One Meta lookup per alert, shared by every recipient.
    const approved = await step.run("approved-templates", async () => {
      const { loadApprovedDigestTemplates } = await import("@/lib/crm/digest-send");
      return loadApprovedDigestTemplates();
    });
    const sent: Record<string, string> = {};
    for (const recipientId of recipients) {
      sent[recipientId] = await step.run(`send-${recipientId}`, async () => {
        const { sendOwnerAlert } = await import("@/lib/crm/alerts-send");
        return sendOwnerAlert(tenantId, taskId, recipientId, new Date(), new Set(approved));
      });
    }
    return { recipients: recipients.length, sent };
  },
);

/** Drop expired demo tenants and wipe page text still inside the rate-limit window. */
// export const purgeRapidDemos = inngest.createFunction(
//   { id: "purge-rapid-demos", retries: 1 },
//   { cron: "15 3 * * *" },
//   async ({ step }) =>
//     step.run("purge", async () => {
//       const { purgeExpiredRapidDemos } = await import("@/lib/rapid-demo/cleanup");
//       return purgeExpiredRapidDemos();
//     }),
// );

export const inngestFunctions = [runAgentTurn, nudgeIfSilent, crmDigest, ownerAlert
    // , purgeRapidDemos
];
