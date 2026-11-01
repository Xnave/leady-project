import { isProductionRuntime } from "@/lib/dev-auth-bypass";
import { prisma } from "@/lib/db";
import { loadTurnContext, markLeadForceFreshInbound, persistInboundIfNew } from "@/lib/conversations";
import { batchLeadRefreshes } from "@/lib/crm/refresh";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { closeConversationAsDone } from "@/lib/flow/rotate-conversation";
import { decideRegisteredRequest } from "@/lib/flow/registry";
import { runTurnNow, sendAndSave, tryDispatchNudgeEvent, tryDispatchOwnerAlertEvents, tryEnqueueAgentTurn } from "@/lib/flow/run-turn";
import { ensureLocalDemoChannel } from "@/lib/provision-tenant";
import { getRequest, REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { isScenarioSender, scenarioLeadPurgeWhere, scenarioSender } from "./guard";
import { loadScenarioSnapshot } from "./snapshot";
import type { ScenarioSnapshot } from "./types";

export class ScenarioHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const REPLY_TIMEOUT_MS = 45_000;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function scenarioLead(tenantId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) throw new ScenarioHttpError(404, "not_found");
  if (!isScenarioSender(lead.externalUserId)) throw new ScenarioHttpError(403, "not_scenario_lead");
  return lead;
}

async function enabledChannel(tenantId: string) {
  let channel = await prisma.channelConnection.findFirst({
    where: { tenantId, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  if (!channel && !isProductionRuntime()) {
    await ensureLocalDemoChannel(tenantId);
    channel = await prisma.channelConnection.findFirst({
      where: { tenantId, enabled: true },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!channel) throw new ScenarioHttpError(400, "no_channel");
  return channel;
}

async function agentReplied(conversationId: string, after: Date): Promise<boolean> {
  const message = await prisma.message.findFirst({
    where: { conversationId, role: "agent", createdAt: { gt: after } },
    select: { id: true },
  });
  return Boolean(message);
}

async function waitForAgentReply(conversationId: string, after: Date): Promise<boolean> {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await agentReplied(conversationId, after)) return true;
    await sleep(400);
  }
  return false;
}

export async function sendScenarioTurn(opts: {
  tenantId: string;
  text: string;
  leadId?: string;
  scenarioId?: string;
  runId?: string;
}): Promise<{ answered: boolean; snapshot: ScenarioSnapshot }> {
  const text = opts.text.trim();
  if (!text) throw new ScenarioHttpError(400, "empty_message");

  let from: string;
  let displayName: string | undefined;
  if (opts.leadId) {
    const lead = await scenarioLead(opts.tenantId, opts.leadId);
    from = lead.externalUserId;
  } else {
    if (!opts.scenarioId || !opts.runId) throw new ScenarioHttpError(400, "scenario_id_required");
    from = scenarioSender(opts.scenarioId, opts.runId);
    displayName = `תרחיש ${opts.scenarioId}`;
  }

  const channel = await enabledChannel(opts.tenantId);
  const started = new Date();
  const inserted = await persistInboundIfNew({
    tenantId: opts.tenantId,
    channelId: channel.id,
    agentId: channel.agentId,
    providerMessageId: `scenario-${crypto.randomUUID()}`,
    from,
    text,
    displayName,
  });
  if (!inserted) throw new ScenarioHttpError(409, "duplicate_message");

  const enqueued = await tryEnqueueAgentTurn({
    tenantId: opts.tenantId,
    conversationId: inserted.conversationId,
    triggerMessageId: inserted.messageId,
  });
  let answered = false;
  if (enqueued) {
    answered = await waitForAgentReply(inserted.conversationId, started);
  } else {
    const turn = await runTurnNow({
      tenantId: opts.tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
    await tryDispatchNudgeEvent(turn.nudgeEvent);
    await tryDispatchOwnerAlertEvents(turn.ownerAlertEvents);
    answered = await agentReplied(inserted.conversationId, started);
  }

  const snapshot = await loadScenarioSnapshot(opts.tenantId, inserted.leadId);
  if (!snapshot) throw new ScenarioHttpError(500, "snapshot_missing");
  return { answered, snapshot };
}

export async function decideScenarioRequest(opts: {
  tenantId: string;
  requestId: string;
  decision: "approve" | "decline" | "reschedule";
  alternativeStart?: string;
  alternativeEnd?: string;
}): Promise<ScenarioSnapshot> {
  return batchLeadRefreshes(async () => {
    const request = await getRequest({ tenantId: opts.tenantId, requestId: opts.requestId });
    if (!request) throw new ScenarioHttpError(404, "not_found");
    await scenarioLead(opts.tenantId, request.leadId);

    const openTasks = await prisma.hitlTask.findMany({
      where: { tenantId: opts.tenantId, leadId: request.leadId, status: "open", type: REQUEST_APPROVAL_TASK },
      select: { payload: true },
    });
    const hasOpenTask = openTasks.some(
      (task) => (task.payload as { requestId?: string })?.requestId === request.id,
    );
    if (!hasOpenTask) {
      const latest = await prisma.conversation.findFirst({
        where: { leadId: request.leadId, tenantId: opts.tenantId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!latest || latest.id !== request.conversationId) {
        throw new ScenarioHttpError(409, "stale_conversation");
      }
    }

    ensureFlowRegistry();
    const result = await decideRegisteredRequest(request.capabilityId, {
      tenantId: opts.tenantId,
      requestId: request.id,
      actorUserId: "scenario_runner",
      decision: opts.decision,
      alternativeStart: opts.alternativeStart,
      alternativeEnd: opts.alternativeEnd,
    });
    const ctx = await loadTurnContext(opts.tenantId, result.conversationId);
    await sendAndSave(ctx, result.text);
    if (result.closeAsDone) {
      await closeConversationAsDone({
        tenantId: opts.tenantId,
        conversationId: result.conversationId,
        reason: "approve",
      });
    }
    const snapshot = await loadScenarioSnapshot(opts.tenantId, request.leadId);
    if (!snapshot) throw new ScenarioHttpError(500, "snapshot_missing");
    return snapshot;
  });
}

export async function endScenarioThread(tenantId: string, leadId: string): Promise<ScenarioSnapshot> {
  return batchLeadRefreshes(async () => {
    await scenarioLead(tenantId, leadId);
    const open = await prisma.conversation.findMany({
      where: { leadId, tenantId, status: { not: "closed" } },
      select: { id: true },
    });
    for (const conversation of open) {
      await closeConversationAsDone({ tenantId, conversationId: conversation.id, reason: "admin" });
    }
    await markLeadForceFreshInbound(tenantId, leadId);
    const snapshot = await loadScenarioSnapshot(tenantId, leadId);
    if (!snapshot) throw new ScenarioHttpError(500, "snapshot_missing");
    return snapshot;
  });
}

export async function purgeScenarioLeads(
  tenantIds: string[],
  opts?: { leadId?: string; before?: Date },
): Promise<{ deleted: number }> {
  const leadId = opts?.leadId;
  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId: { in: tenantIds } },
    });
    if (!lead) throw new ScenarioHttpError(404, "not_found");
    if (!isScenarioSender(lead.externalUserId)) throw new ScenarioHttpError(403, "not_scenario_lead");
    await prisma.lead.delete({ where: { id: lead.id } });
    return { deleted: 1 };
  }
  const result = await prisma.lead.deleteMany({
    where: scenarioLeadPurgeWhere(tenantIds, opts?.before),
  });
  return { deleted: result.count };
}
