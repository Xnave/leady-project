import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@/lib/db";
import type { FlowDefinition } from "@/lib/flow/types";
import { REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { OPEN_APPROVAL_TASK, OPEN_HANDOFF_TASK } from "./needs";
import { planLeadState, type LeadStatePlan, type LeadStateSnapshot } from "./plan";
import { isFollowUpReason, isPipelineStage } from "./types";

/** Everything planLeadState needs, read in one pass. Tenant-scoped. */
export async function loadLeadStateSnapshot(
  tenantId: string,
  leadId: string,
): Promise<LeadStateSnapshot | null> {
  const convoSelect = { flowState: true, agent: { select: { flow: true } } } as const;
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      // The conversation the bot is on now: the newest one still open.
      conversations: {
        where: { status: { not: "closed" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: convoSelect,
      },
      requests: { select: { status: true, kind: true, updatedAt: true } },
      // Same predicate as the "needs you" list, so the stored reason can't disagree with it.
      hitlTasks: {
        where: { OR: [OPEN_HANDOFF_TASK, OPEN_APPROVAL_TASK] },
        select: { type: true, createdAt: true },
      },
    },
  });
  if (!lead) return null;

  const [convo, lastByRole] = await Promise.all([
    // Every conversation closed: the stage still reads the last one's flow position.
    lead.conversations[0] ??
      prisma.conversation.findFirst({
        where: { tenantId, leadId },
        orderBy: { createdAt: "desc" },
        select: convoSelect,
      }),
    prisma.message.groupBy({
      by: ["role"],
      where: { tenantId, conversation: { leadId } },
      _max: { createdAt: true },
    }),
  ]);
  const lastAt = (role: string) => lastByRole.find((g) => g.role === role)?._max.createdAt ?? null;
  const latest = (...ds: (Date | null)[]) =>
    ds.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);

  // The oldest open task sets "waiting since": the owner has been needed from then on.
  const oldest = (approval: boolean) =>
    earliest(
      lead.hitlTasks.filter((t) => (t.type === REQUEST_APPROVAL_TASK) === approval).map((t) => t.createdAt),
    );
  const lastRequestChangeAt = latest(...lead.requests.map((r) => r.updatedAt));

  return {
    current: {
      pipelineStage: isPipelineStage(lead.pipelineStage) ? lead.pipelineStage : "new",
      pipelineStageSource: lead.pipelineStageSource === "manual" ? "manual" : "auto",
      pipelineStageReason: lead.pipelineStageReason,
      pipelineStageChangedAt: lead.pipelineStageChangedAt,
      attentionReason: isFollowUpReason(lead.attentionReason) ? lead.attentionReason : null,
      attentionAt: lead.attentionAt,
      snoozedUntil: lead.snoozedUntil,
      nextStepAt: lead.nextStepAt,
      lastLeadMessageAt: lead.lastLeadMessageAt,
      lastOutboundAt: lead.lastOutboundAt,
    },
    signals: {
      flow: (convo?.agent.flow as FlowDefinition | undefined) ?? null,
      currentFlowStage: convo?.flowState ?? null,
      fields: (lead.fields as Record<string, unknown>) ?? {},
      hasAgentReply: lastAt("agent") != null,
      requests: lead.requests.map((r) => ({ status: r.status, kind: r.kind })),
    },
    openHandoffSince: oldest(false),
    pendingApprovalSince: oldest(true),
    lastLeadMessageAt: lastAt("lead"),
    lastOutboundAt: latest(lastAt("agent"), lastAt("human")),
    lastRequestChangeAt,
  };
}

function earliest(ds: Date[]): Date | null {
  return ds.reduce<Date | null>((min, d) => (!min || d < min ? d : min), null);
}

/** The only writer of the CRM columns (besides explicit owner actions in crm/actions.ts). */
export async function refreshLeadState(
  tenantId: string,
  leadId: string,
  opts?: { now?: Date; actorUserId?: string },
): Promise<LeadStatePlan | null> {
  const snapshot = await loadLeadStateSnapshot(tenantId, leadId);
  if (!snapshot) return null;
  const plan = planLeadState(snapshot, opts?.now ?? new Date());
  if (Object.keys(plan.patch).length === 0) return plan;
  await prisma.$transaction([
    prisma.lead.updateMany({ where: { id: leadId, tenantId }, data: plan.patch }),
    ...(plan.stageEvent
      ? [
          prisma.leadStageEvent.create({
            data: { tenantId, leadId, ...plan.stageEvent, actorUserId: opts?.actorUserId ?? null },
          }),
        ]
      : []),
  ]);
  return plan;
}

type RefreshOpts = { now?: Date; actorUserId?: string };

/** A refresh slower than this is logged, so hot paths can be watched in prod. */
const SLOW_REFRESH_MS = 250;

/** For turn / webhook paths: CRM bookkeeping must never fail the caller. */
export async function safeRefreshLeadState(tenantId: string, leadId: string, opts?: RefreshOpts): Promise<void> {
  const pending = batch.getStore();
  if (pending) {
    pending.set(`${tenantId}:${leadId}`, { tenantId, leadId, opts });
    return;
  }
  const started = Date.now();
  try {
    await refreshLeadState(tenantId, leadId, opts);
  } catch (err) {
    console.error(JSON.stringify({ msg: "crm.refresh_failed", tenantId, leadId, error: String(err) }));
  }
  const ms = Date.now() - started;
  if (ms > SLOW_REFRESH_MS) console.warn(JSON.stringify({ msg: "crm.refresh_slow", tenantId, leadId, ms }));
}

const batch = new AsyncLocalStorage<Map<string, { tenantId: string; leadId: string; opts?: RefreshOpts }>>();

/**
 * Runs `fn` with lead refreshes deferred: however many times the code inside asks
 * (one per saved message, per closed thread, …), each lead is refreshed once, after
 * `fn` settles — even when it throws, since what it wrote before failing still counts.
 * Nested calls join the outer batch.
 */
export async function batchLeadRefreshes<T>(fn: () => Promise<T>): Promise<T> {
  if (batch.getStore()) return fn();
  const pending = new Map<string, { tenantId: string; leadId: string; opts?: RefreshOpts }>();
  try {
    return await batch.run(pending, fn);
  } finally {
    for (const p of pending.values()) {
      await safeRefreshLeadState(p.tenantId, p.leadId, { ...p.opts, now: undefined });
    }
  }
}
