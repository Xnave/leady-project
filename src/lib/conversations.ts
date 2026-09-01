import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { isChatLanguage } from "@/lib/flow/locale";
import { defaultFlow, defaultHitlPolicy, defaultLeadSchema } from "@/lib/flow/validate";
import type { AgentSnapshot, TurnContext } from "@/lib/flow/types";
import type { FlowDefinition, HitlPolicy, LeadSchema } from "@/lib/flow/types";

export async function persistInboundIfNew(opts: {
  tenantId: string;
  channelId: string;
  agentId: string;
  providerMessageId: string;
  from: string;
  text: string;
  extraFields?: Record<string, unknown>;
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

  const channel = await prisma.channelConnection.findFirstOrThrow({
    where: { id: opts.channelId, tenantId: opts.tenantId },
    include: { agent: true },
  });

  const extraFields = { ...(opts.extraFields ?? {}) };
  if (channel.provider === "whatsapp" && /^\+?\d[\d\s-]{7,}\d$/.test(opts.from.trim())) {
    extraFields.phone = extraFields.phone ?? opts.from.trim();
  }

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
      displayName: opts.from,
      fields: extraFields as Prisma.InputJsonValue,
    },
    update: {},
  });

  const current = (lead.fields as Record<string, unknown>) ?? {};
  const patch = { ...extraFields };
  if (current.phone) delete patch.phone;
  if (Object.keys(patch).length > 0) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        fields: { ...current, ...patch } as Prisma.InputJsonValue,
      },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { tenantId: opts.tenantId, leadId: lead.id, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
  });

  const flow = channel.agent.flow as FlowDefinition;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId: opts.tenantId,
        leadId: lead.id,
        channelId: opts.channelId,
        agentId: opts.agentId,
        status: "open",
        flowState: flow.start,
        flowVersion: channel.agent.flowVersion,
      },
    });
  }

  try {
    const message = await prisma.message.create({
      data: {
        tenantId: opts.tenantId,
        conversationId: conversation.id,
        role: "lead",
        text: opts.text,
        providerMessageId: opts.providerMessageId,
      },
    });
    return { conversationId: conversation.id, messageId: message.id, leadId: lead.id };
  } catch (err) {
    //Unique Constraint Violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return null;
    }
    throw err;
  }
}

export async function loadTurnContext(
  tenantId: string,
  conversationId: string,
): Promise<TurnContext & { connection: ConnectionView }> {
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { id: conversationId, tenantId },
    include: {
      lead: true,
      agent: true,
      channel: true,
      tenant: true,
      messages: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });

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

  const fields = { ...((conversation.lead.fields as Record<string, unknown>) ?? {}) };
  const leadPhone =
    typeof fields.phone === "string" && fields.phone.trim() ? fields.phone.trim() : undefined;

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
      venueAddress: conversation.tenant.venueAddress ?? "",
      venueHours: conversation.tenant.venueHours ?? "",
      bookingRequestTemplate: conversation.tenant.bookingRequestTemplate ?? "",
      bookingApprovedTemplate: conversation.tenant.bookingApprovedTemplate ?? "",
      bookingRejectedTemplate: conversation.tenant.bookingRejectedTemplate ?? "",
    },
    agent,
    conversation: {
      id: conversation.id,
      status: conversation.status as "open" | "waiting_human" | "closed",
      flowState: conversation.flowState,
      flowVersion: conversation.flowVersion,
      nudgeCountByStage: (conversation.nudgeCountByStage as Record<string, number>) ?? {},
    },
    lead: {
      id: conversation.lead.id,
      externalUserId: conversation.lead.externalUserId,
      fields,
    },
    messages: conversation.messages.map((m) => ({
      role: m.role as "lead" | "agent" | "human" | "system",
      text: m.text,
      createdAt: m.createdAt,
    })),
    channel: {
      provider: conversation.channel.provider,
      customerPhone: leadPhone,
    },
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

export async function persistLeadFields(
  tenantId: string,
  leadId: string,
  fields: Record<string, unknown>,
) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { fields: fields as Prisma.InputJsonValue },
  });
}

export async function insertAgentMessage(
  tenantId: string,
  conversationId: string,
  text: string,
) {
  await prisma.message.create({
    data: {
      tenantId,
      conversationId,
      role: "agent",
      text,
      providerMessageId: `out-${crypto.randomUUID()}`,
    },
  });
}

export async function pauseForHuman(opts: {
  tenantId: string;
  conversationId: string;
  leadId: string;
  reason: string;
}) {
  await prisma.$transaction([
    prisma.hitlTask.create({
      data: {
        tenantId: opts.tenantId,
        conversationId: opts.conversationId,
        leadId: opts.leadId,
        type: "more_info",
        reason: opts.reason,
        status: "open",
      },
    }),
    prisma.conversation.update({
      where: { id: opts.conversationId },
      data: { status: "waiting_human" },
    }),
  ]);
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
    prisma.conversation.update({
      where: { id: task.conversationId },
      data: { status: "open" },
    }),
  ]);
  return task;
}
