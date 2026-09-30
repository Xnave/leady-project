import { prisma } from "@/lib/db";
import type { FlowDefinition } from "@/lib/flow/types";
import { REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { approvalWaitingSince } from "./followup";
import { planLeadState, type LeadStatePlan, type LeadStateSnapshot } from "./plan";
import { isFollowUpReason, isPipelineStage } from "./types";

/** Everything planLeadState needs, read in one pass. Tenant-scoped. */
export async function loadLeadStateSnapshot(
  tenantId: string,
  leadId: string,
): Promise<LeadStateSnapshot | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: {
      conversations: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { flowState: true, agent: { select: { flow: true } } },
      },
      requests: { select: { id: true, status: true, kind: true, createdAt: true, updatedAt: true } },
      hitlTasks: {
        where: { status: "open", type: { not: REQUEST_APPROVAL_TASK } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!lead) return null;

  const [lastLead, lastOut, agentReply] = await Promise.all([
    prisma.message.findFirst({
      where: { tenantId, role: "lead", conversation: { leadId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.message.findFirst({
      where: { tenantId, role: { in: ["agent", "human"] }, conversation: { leadId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.message.findFirst({
      where: { tenantId, role: "agent", conversation: { leadId } },
      select: { id: true },
    }),
  ]);

  // A reschedule offer keeps the request pending but hands the move to the customer.
  const approvalTasks = await prisma.hitlTask.findMany({
    where: { tenantId, leadId, status: "open", type: REQUEST_APPROVAL_TASK },
    select: { payload: true },
  });
  const awaitingCustomer = new Set(
    approvalTasks
      .map((t) => (t.payload ?? {}) as { requestId?: string; awaitingCustomerConfirm?: boolean })
      .filter((p) => p.awaitingCustomerConfirm && p.requestId)
      .map((p) => p.requestId as string),
  );
  const lastRequestChangeAt = lead.requests.reduce<Date | null>(
    (max, r) => (!max || r.updatedAt > max ? r.updatedAt : max),
    null,
  );
  const convo = lead.conversations[0];

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
      hasAgentReply: Boolean(agentReply),
      requests: lead.requests.map((r) => ({ status: r.status, kind: r.kind })),
    },
    openHandoffSince: lead.hitlTasks[0]?.createdAt ?? null,
    pendingApprovalSince: approvalWaitingSince(lead.requests, awaitingCustomer),
    lastLeadMessageAt: lastLead?.createdAt ?? null,
    lastOutboundAt: lastOut?.createdAt ?? null,
    lastRequestChangeAt,
  };
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

/** For turn / webhook paths: CRM bookkeeping must never fail the caller. */
export async function safeRefreshLeadState(
  tenantId: string,
  leadId: string,
  opts?: { now?: Date; actorUserId?: string },
): Promise<void> {
  try {
    await refreshLeadState(tenantId, leadId, opts);
  } catch (err) {
    console.error(JSON.stringify({ msg: "crm.refresh_failed", tenantId, leadId, error: String(err) }));
  }
}
