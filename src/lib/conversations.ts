import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { resolveActorLabel } from "@/lib/admin-decisions";
import { isChatLanguage } from "@/lib/flow/locale";
import { defaultFlow, defaultHitlPolicy, defaultLeadSchema } from "@/lib/flow/validate";
import type { AgentSnapshot, TurnContext } from "@/lib/flow/types";
import type { FlowDefinition, HitlPolicy, LeadFields, LeadSchema } from "@/lib/flow/types";
import { looksLikePhoneNumber } from "@/lib/flow/booking-collect";
import { hasRelevantRequest } from "@/lib/requests";
import {
  clearBookingSessionFields,
  mergeLeadAndSession,
  splitCrmAndSession,
} from "@/lib/flow/booking";
import { clearReservationSessionFields } from "@/lib/flow/reservation-collect";
import { parseReservationConfig } from "@/lib/flow/reservation-config";
import {
  loadCapabilityInstances,
  loadInstanceConfig,
} from "@/lib/capability-instances";
import { ensureFlowRegistry } from "@/lib/flow/capabilities";
import { capabilityStateLoaders } from "@/lib/flow/registry";
import {
  closeConversationAsDone,
  decideInboundThread,
  reopenConversation,
  resumeConversationAfterHitl,
} from "@/lib/flow/rotate-conversation";
import {
  contactDisplayName,
  displayNameFromLeadFields,
  instagramIdentityFields,
  leadInstagramUsername,
  looksLikePlatformUserId,
} from "@/lib/leads";
import { fetchZernioInboxContact } from "@/lib/zernio";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { addTurnPerf } from "@/lib/perf";

export {
  reopenConversation,
  resumeConversationAfterHitl,
  rotateConversation,
} from "@/lib/flow/rotate-conversation";

const FORCE_FRESH_INBOUND_KEY = "force_fresh_inbound";

/** After admin ends a chat, the next customer message must start a clean thread. */
export async function markLeadForceFreshInbound(tenantId: string, leadId: string): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { fields: true },
  });
  if (!lead) return;
  const fields = { ...((lead.fields as LeadFields) ?? {}) };
  fields[FORCE_FRESH_INBOUND_KEY] = "1";
  await prisma.lead.update({
    where: { id: leadId },
    data: { fields: fields as Prisma.InputJsonValue },
  });
}

export async function clearLeadForceFreshInbound(tenantId: string, leadId: string): Promise<void> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { fields: true },
  });
  if (!lead) return;
  const fields = { ...((lead.fields as LeadFields) ?? {}) };
  if (!(FORCE_FRESH_INBOUND_KEY in fields)) return;
  delete fields[FORCE_FRESH_INBOUND_KEY];
  await prisma.lead.update({
    where: { id: leadId },
    data: { fields: fields as Prisma.InputJsonValue },
  });
}

type InboundChannel = Prisma.ChannelConnectionGetPayload<{
  include: { agent: true; tenant: true };
}>;

const inboundConvoInclude = {
  messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
};

export async function persistInboundIfNew(opts: {
  tenantId: string;
  channelId: string;
  agentId: string;
  providerMessageId: string;
  from: string;
  text: string;
  displayName?: string;
  extraFields?: Record<string, unknown>;
  /** Skip a second channel+agent+tenant read when the webhook already loaded them. */
  channel?: InboundChannel;
}): Promise<{ conversationId: string; messageId: string; leadId: string } | null> {
  const existing = await prisma.message.findUnique({
    where: {
      tenantId_providerMessageId: {
        tenantId: opts.tenantId,
        providerMessageId: opts.providerMessageId,
      },
    },
  });
  if (existing) return null;

  const channel =
    opts.channel ??
    (await prisma.channelConnection.findFirstOrThrow({
      where: { id: opts.channelId, tenantId: opts.tenantId },
      include: { agent: true, tenant: true },
    }));

  const extraFields = { ...(opts.extraFields ?? {}) };
  if (channel.provider === "whatsapp" && looksLikePhoneNumber(opts.from.trim())) {
    extraFields.phone = extraFields.phone ?? opts.from.trim();
  }

  const displayName = opts.displayName?.trim() || opts.from;

  const lead = await prisma.lead.upsert({
    where: {
      tenantId_channelId_externalUserId: {
        tenantId: opts.tenantId,
        channelId: opts.channelId,
        externalUserId: opts.from,
      },
    },
    create: {
      tenantId: opts.tenantId,
      channelId: opts.channelId,
      externalUserId: opts.from,
      displayName,
      fields: extraFields as Prisma.InputJsonValue,
      adminUnread: true,
    },
    update: { adminUnread: true },
  });

  const current = (lead.fields as Record<string, unknown>) ?? {};
  const patch = { ...extraFields };
  if (current.phone) delete patch.phone;
  if (typeof current.name === "string" && current.name.trim()) delete patch.name;
  if (typeof current.instagramUsername === "string" && current.instagramUsername.trim()) {
    delete patch.instagramUsername;
  }

  const shouldRename =
    displayName !== opts.from &&
    (!lead.displayName ||
      lead.displayName === opts.from ||
      lead.displayName === lead.externalUserId ||
      looksLikePlatformUserId(lead.displayName));

  if (Object.keys(patch).length > 0 || shouldRename) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(shouldRename ? { displayName } : {}),
        ...(Object.keys(patch).length > 0
          ? { fields: { ...current, ...patch } as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { tenantId: opts.tenantId, leadId: lead.id, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
    include: inboundConvoInclude,
  });

  const flow = channel.agent.flow as FlowDefinition;
  const leadFields = (lead.fields as LeadFields) ?? {};
  const forceFresh = String(leadFields[FORCE_FRESH_INBOUND_KEY] ?? "") === "1";
  const idleResetDays = channel.tenant.idleResetDays ?? 3;

  // Admin "סיים שיחה" → next inbound must not continue a lingering open thread.
  if (forceFresh && conversation) {
    await closeConversationAsDone({
      tenantId: opts.tenantId,
      conversationId: conversation.id,
      reason: "admin",
    });
    conversation = null;
  }

  if (!conversation) {
    const [latestClosed, relevantRequest] = await Promise.all([
      prisma.conversation.findFirst({
        where: { tenantId: opts.tenantId, leadId: lead.id, status: "closed" },
        orderBy: { updatedAt: "desc" },
        include: inboundConvoInclude,
      }),
      hasRelevantRequest({ tenantId: opts.tenantId, leadId: lead.id }),
    ]);
    const closedLastMessageAt =
      latestClosed?.messages[0]?.createdAt ?? latestClosed?.updatedAt ?? null;
    const decision = decideInboundThread({
      forceFresh,
      hasOpenConversation: false,
      closedLastMessageAt,
      idleResetDays,
      hasRelevantRequest: relevantRequest,
    });
    if (decision === "reopen" && latestClosed) {
      const reopened = await reopenConversation({
        tenantId: opts.tenantId,
        conversationId: latestClosed.id,
        reason: "inbound_reopen",
      });
      conversation = await prisma.conversation.findFirst({
        where: { id: reopened.conversationId, tenantId: opts.tenantId },
        include: inboundConvoInclude,
      });
    }
  }

  // First inbound, staff forced a clean start, or idle past the window with no upcoming request.
  if (!conversation) {
    const prevFields = { ...((lead.fields as LeadFields) ?? {}) };
    delete prevFields[FORCE_FRESH_INBOUND_KEY];
    const reservationConfig = parseReservationConfig(
      await loadInstanceConfig({
        tenantId: opts.tenantId,
        capabilityId: "reservations",
      }),
    );
    const cleared = clearReservationSessionFields(
      clearBookingSessionFields(prevFields),
      reservationConfig,
    );
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        fields: cleared as Prisma.InputJsonValue,
        adminUnread: true,
      },
    });
    conversation = await prisma.conversation.create({
      data: {
        tenantId: opts.tenantId,
        leadId: lead.id,
        channelId: opts.channelId,
        agentId: opts.agentId,
        status: "open",
        flowState: flow.start,
        flowVersion: channel.agent.flowVersion,
        summary: "",
        lifecycleReason: "inbound_create",
        session: {} as Prisma.InputJsonValue,
      },
      include: inboundConvoInclude,
    });
  }

  try {
    const now = new Date();
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          tenantId: opts.tenantId,
          conversationId: conversation.id,
          role: "lead",
          text: opts.text,
          providerMessageId: opts.providerMessageId,
          createdAt: now,
        },
      }),
      // Denorm clock so refreshLeadState can skip message.groupBy on the hot path.
      prisma.lead.update({
        where: { id: lead.id },
        data: { lastLeadMessageAt: now, adminUnread: true },
      }),
    ]);
    // CRM refresh is deferred to the turn so enqueue is not blocked.
    return { conversationId: conversation.id, messageId: message.id, leadId: lead.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return null;
    }
    throw err;
  }
}

/** Talk uses the last 12; a small buffer covers lastLeadMessageAt / restart. Newest first from SQL, then reversed. */
const TURN_MESSAGE_TAKE = 16;

export async function loadTurnContext(
  tenantId: string,
  conversationId: string,
): Promise<TurnContext & { connection: ConnectionView }> {
  const loadStarted = Date.now();
  ensureFlowRegistry();
  const convoStarted = Date.now();
  const instancesStarted = Date.now();
  // Instances only need tenantId — overlap with the fat conversation read.
  const [conversation, capabilityInstances] = await Promise.all([
    prisma.conversation.findFirstOrThrow({
      where: { id: conversationId, tenantId },
      select: {
        id: true,
        status: true,
        flowState: true,
        flowVersion: true,
        nudgeCountByStage: true,
        summary: true,
        lifecycleReason: true,
        session: true,
        lead: { select: { id: true, externalUserId: true, fields: true } },
        agent: {
          select: {
            id: true,
            catalogId: true,
            systemPrompt: true,
            knowledgeText: true,
            flow: true,
            flowVersion: true,
            leadSchema: true,
            hitlPolicy: true,
            calcomEventTypeId: true,
          },
        },
        channel: {
          select: {
            id: true,
            provider: true,
            providerAccountId: true,
            apiBase: true,
            accessTokenEnc: true,
            providerExternalId: true,
          },
        },
        tenant: {
          select: {
            name: true,
            phone: true,
            intro: true,
            chatLanguage: true,
            idleResetDays: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: TURN_MESSAGE_TAKE,
          select: { role: true, text: true, createdAt: true },
        },
      },
    }),
    loadCapabilityInstances(tenantId),
  ]);
  const load_convo_ms = Date.now() - convoStarted;
  const load_instances_ms = Date.now() - instancesStarted;
  const messagesChrono = [...conversation.messages].reverse();

  const agent: AgentSnapshot = {
    id: conversation.agent.id,
    tenantId,
    catalogId: conversation.agent.catalogId,
    systemPrompt: conversation.agent.systemPrompt,
    knowledgeText: conversation.agent.knowledgeText,
    flow: (conversation.agent.flow as FlowDefinition) ?? defaultFlow(),
    flowVersion: conversation.agent.flowVersion,
    leadSchema: (conversation.agent.leadSchema as LeadSchema) ?? defaultLeadSchema,
    hitlPolicy: (conversation.agent.hitlPolicy as HitlPolicy) ?? defaultHitlPolicy,
    calcomEventTypeId: conversation.agent.calcomEventTypeId,
  };

  const leadFieldsRaw = { ...((conversation.lead.fields as LeadFields) ?? {}) };
  const sessionRaw = { ...((conversation.session as LeadFields) ?? {}) };
  const { crm, session: leakedFromLead } = splitCrmAndSession(leadFieldsRaw);
  // Conversation.session wins; leaked Lead keys are migrated once then stripped.
  const session = mergeLeadAndSession(leakedFromLead, sessionRaw);
  const fields = mergeLeadAndSession(crm, session);

  if (Object.keys(leakedFromLead).length > 0) {
    await prisma.lead.update({
      where: { id: conversation.lead.id },
      data: { fields: crm as Prisma.InputJsonValue },
    });
    if (Object.keys(sessionRaw).length === 0 && Object.keys(session).length > 0) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { session: session as Prisma.InputJsonValue },
      });
    }
  }

  const fromId = conversation.lead.externalUserId?.trim() ?? "";
  const leadPhone =
    (typeof fields.phone === "string" && fields.phone.trim()) ||
    (looksLikePhoneNumber(fromId) ? fromId : "") ||
    undefined;

  const capabilityState: Record<string, unknown> = {};
  const stateStarted = Date.now();
  await Promise.all(
    capabilityStateLoaders().map(async ({ id, load }) => {
      const state = await load({
        tenantId,
        leadId: conversation.lead.id,
        conversationId: conversation.id,
      });
      if (state !== undefined) capabilityState[id] = state;
    }),
  );
  addTurnPerf({
    load_ms: Date.now() - loadStarted,
    load_convo_ms,
    load_instances_ms,
    load_capability_state_ms: Date.now() - stateStarted,
  });

  return {
    tenantId,
    tenant: {
      name: conversation.tenant.name,
      phone: conversation.tenant.phone ?? "",
      intro: conversation.tenant.intro ?? "",
      chatLanguage: isChatLanguage(conversation.tenant.chatLanguage)
        ? conversation.tenant.chatLanguage
        : "multi",
      idleResetDays: conversation.tenant.idleResetDays ?? 5,
      capabilityInstances,
    },
    agent,
    conversation: {
      id: conversation.id,
      status: conversation.status as "open" | "waiting_human" | "closed",
      flowState: conversation.flowState,
      flowVersion: conversation.flowVersion,
      nudgeCountByStage: (conversation.nudgeCountByStage as Record<string, number>) ?? {},
      summary: conversation.summary ?? "",
      lifecycleReason: conversation.lifecycleReason || undefined,
    },
    lead: {
      id: conversation.lead.id,
      externalUserId: conversation.lead.externalUserId,
      fields,
    },
    messages: messagesChrono.map((m) => ({
      role: m.role as "lead" | "agent" | "human" | "system",
      text: m.text,
      createdAt: m.createdAt,
    })),
    channel: {
      provider: conversation.channel.provider,
      customerPhone: leadPhone,
    },
    capabilityState,
    connection: {
      id: conversation.channel.id,
      provider: conversation.channel.provider,
      providerAccountId: conversation.channel.providerAccountId,
      apiBase: conversation.channel.apiBase,
      accessToken: decryptSecret(conversation.channel.accessTokenEnc),
      zernioAccountId: conversation.channel.providerExternalId || undefined,
    },
  };
}

export type ConnectionView = {
  id: string;
  provider: string;
  providerAccountId: string;
  apiBase: string;
  accessToken: string;
  zernioAccountId?: string;
};

export async function persistStage(tenantId: string, conversationId: string, stageId: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { flowState: stageId },
  });
}

/**
 * Persist a turn's working fields bag: CRM → Lead.fields, booking session → Conversation.session.
 * Always strips session keys from Lead so they cannot leak into the next thread.
 */
export async function persistTurnFields(
  tenantId: string,
  leadId: string,
  conversationId: string,
  fields: Record<string, unknown>,
  opts?: { extraSessionKeys?: readonly string[] },
) {
  const { crm, session } = splitCrmAndSession(fields as LeadFields, opts?.extraSessionKeys);
  const displayName = displayNameFromLeadFields(crm);
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: {
        fields: crm as Prisma.InputJsonValue,
        ...(displayName ? { displayName } : {}),
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { session: session as Prisma.InputJsonValue },
    }),
  ]);
}

/** CRM-only write (admin edit). Never writes booking session keys to Lead. */
export async function persistLeadFields(
  tenantId: string,
  leadId: string,
  fields: Record<string, unknown>,
) {
  const { crm } = splitCrmAndSession(fields as LeadFields);
  const displayName = displayNameFromLeadFields(crm);
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      fields: crm as Prisma.InputJsonValue,
      ...(displayName ? { displayName } : {}),
    },
  });
}

export async function insertAgentMessage(
  tenantId: string,
  conversationId: string,
  text: string,
  opts?: { providerMessageId?: string; leadId?: string },
) {
  const now = new Date();
  await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      role: "agent",
      text,
      providerMessageId: opts?.providerMessageId ?? `out-${crypto.randomUUID()}`,
      createdAt: now,
    },
  });
  if (opts?.leadId) {
    await prisma.lead.updateMany({
      where: { id: opts.leadId, tenantId },
      data: { lastOutboundAt: now },
    });
  } else {
    await prisma.lead.updateMany({
      where: { tenantId, conversations: { some: { id: conversationId } } },
      data: { lastOutboundAt: now },
    });
  }
}

export async function pauseForHuman(opts: {
  tenantId: string;
  conversationId: string;
  leadId: string;
  reason: string;
  summary?: string;
}) {
  await prisma.$transaction([
    prisma.hitlTask.create({
      data: {
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        leadId: opts.leadId,
        type: "more_info",
        reason: opts.reason,
        payload: opts.summary ? { summary: opts.summary } : {},
        status: "open",
      },
    }),
    prisma.conversation.update({
      where: { id: opts.conversationId },
      data: { status: "waiting_human", flowState: "waiting_human" },
    }),
  ]);
}

/**
 * A handoff the teammate answered straight to the customer: the task closes and the
 * thread reopens, but no bot note is added and no bot turn runs, so the bot does not
 * answer again. It picks up at the customer's next message.
 */
export async function completeHitlTaskWithDirectReply(opts: {
  tenantId: string;
  taskId: string;
  actorUserId: string;
  reply: string;
}) {
  const task = await prisma.hitlTask.findFirstOrThrow({
    where: { id: opts.taskId, tenantId: opts.tenantId, status: "open" },
  });
  await prisma.$transaction([
    prisma.hitlTask.update({
      where: { id: task.id },
      data: {
        status: "done",
        resolution: { note: opts.reply, approved: true, directReply: true },
        completedBy: opts.actorUserId,
        completedAt: new Date(),
      },
    }),
    prisma.adminDecisionLog.create({
      data: {
        tenantId: opts.tenantId,
        leadId: task.leadId,
        conversationId: task.conversationId,
        category: "hitl",
        action: "reply",
        actorUserId: opts.actorUserId,
        actorLabel: resolveActorLabel(opts.actorUserId),
        summary: "",
        details: { hitlTaskId: task.id, reason: task.reason, type: task.type, directReply: true } as Prisma.InputJsonValue,
      },
    }),
  ]);
  const resumed = await resumeConversationAfterHitl({
    tenantId: opts.tenantId,
    conversationId: task.conversationId,
  });
  await safeRefreshLeadState(opts.tenantId, task.leadId);
  return { task, conversationId: resumed.conversationId };
}

export async function completeHitlTask(opts: {
  tenantId: string;
  taskId: string;
  actorUserId: string;
  note: string;
  approved?: boolean;
}) {
  const task = await prisma.hitlTask.findFirstOrThrow({
    where: { id: opts.taskId, tenantId: opts.tenantId, status: "open" },
  });
  await prisma.$transaction([
    prisma.hitlTask.update({
      where: { id: task.id },
      data: {
        status: "done",
        resolution: { note: opts.note, approved: opts.approved },
        completedBy: opts.actorUserId,
        completedAt: new Date(),
      },
    }),
    prisma.adminDecisionLog.create({
      data: {
        tenantId: opts.tenantId,
        leadId: task.leadId,
        conversationId: task.conversationId,
        category: "hitl",
        action: opts.approved === false ? "decline" : "approve",
        actorUserId: opts.actorUserId,
        actorLabel: resolveActorLabel(opts.actorUserId),
        summary: "",
        details: {
          hitlTaskId: task.id,
          reason: task.reason,
          type: task.type,
          note: opts.note,
          approved: opts.approved !== false,
        } as Prisma.InputJsonValue,
      },
    }),
    prisma.message.create({
      data: {
        tenantId: opts.tenantId,
        conversationId: task.conversationId,
        role: "human",
        text: opts.note,
        providerMessageId: `hitl-${task.id}`,
        metadata: { hitlTaskId: task.id, approved: opts.approved },
      },
    }),
    prisma.lead.updateMany({
      where: { id: task.leadId, tenantId: opts.tenantId },
      data: { lastOutboundAt: new Date() },
    }),
  ]);
  const resumed = await resumeConversationAfterHitl({
    tenantId: opts.tenantId,
    conversationId: task.conversationId,
  });
  await safeRefreshLeadState(opts.tenantId, task.leadId);
  return { task, conversationId: resumed.conversationId };
}

export async function enrichInstagramLeadIdentity(opts: {
  leadId: string;
  tenantId: string;
}): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: { id: opts.leadId, tenantId: opts.tenantId },
    include: { channel: true },
  });
  if (!lead || lead.channel.provider !== "instagram") return false;

  const fields = (lead.fields ?? {}) as Record<string, unknown>;
  const hasName =
    typeof fields.name === "string" &&
    Boolean(fields.name.trim()) &&
    !looksLikePlatformUserId(fields.name);
  const hasUser = Boolean(leadInstagramUsername(fields));
  const hasDisplay =
    Boolean(lead.displayName?.trim()) && !looksLikePlatformUserId(lead.displayName ?? "");
  if (hasName && hasUser && hasDisplay) return false;

  const conversationId =
    typeof fields.zernioConversationId === "string" ? fields.zernioConversationId : "";
  const accountId = lead.channel.providerExternalId ?? "";
  if (!conversationId || !accountId) return false;

  const contact = await fetchZernioInboxContact({ accountId, conversationId });
  if (!contact) return false;

  const patch = instagramIdentityFields(
    hasName ? undefined : contact.name,
    hasUser ? undefined : contact.username,
  );
  const displayName = contactDisplayName({
    name: (typeof fields.name === "string" ? fields.name : "") || contact.name,
    username: leadInstagramUsername(fields) || contact.username,
    fallback: lead.externalUserId,
  });
  const shouldRename = (!hasDisplay || looksLikePlatformUserId(lead.displayName ?? "")) &&
    displayName !== lead.externalUserId;
  if (Object.keys(patch).length === 0 && !shouldRename) return false;

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(shouldRename ? { displayName } : {}),
      ...(Object.keys(patch).length > 0
        ? { fields: { ...fields, ...patch } as Prisma.InputJsonValue }
        : {}),
    },
  });
  return true;
}
