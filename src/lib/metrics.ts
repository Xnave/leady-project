import { prisma } from "@/lib/db";

export type OwnerMetrics = {
  leadsToday: number;
  leads7d: number;
  activeConversations: number;
  waitingHuman: number;
  openTasks: number;
  meetingsPending: number;
  meetingsApproved7d: number;
  messagesIn7d: number;
  messagesOut7d: number;
  /** Share of conversations started in the window the agent finished on its own. */
  autoHandledPct: number | null;
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export async function getOwnerMetrics(tenantId: string): Promise<OwnerMetrics> {
  const today = startOfToday();
  const week = daysAgo(7);
  const month = daysAgo(30);

  const [
    leadsToday,
    leads7d,
    activeConversations,
    waitingHuman,
    openTasks,
    meetingsPending,
    meetingsApproved7d,
    messagesIn7d,
    messagesOut7d,
    convos30d,
    escalated30d,
  ] = await Promise.all([
    prisma.lead.count({ where: { tenantId, createdAt: { gte: today } } }),
    prisma.lead.count({ where: { tenantId, createdAt: { gte: week } } }),
    prisma.conversation.count({
      where: { tenantId, status: "open", updatedAt: { gte: week } },
    }),
    prisma.conversation.count({ where: { tenantId, status: "waiting_human" } }),
    prisma.hitlTask.count({ where: { tenantId, status: "open" } }),
    prisma.meeting.count({ where: { tenantId, status: "pending" } }),
    prisma.meeting.count({
      where: { tenantId, status: "approved", decidedAt: { gte: week } },
    }),
    prisma.message.count({ where: { tenantId, role: "lead", createdAt: { gte: week } } }),
    prisma.message.count({
      where: { tenantId, role: { in: ["agent", "human"] }, createdAt: { gte: week } },
    }),
    prisma.conversation.count({ where: { tenantId, createdAt: { gte: month } } }),
    prisma.conversation.count({
      where: { tenantId, createdAt: { gte: month }, hitlTasks: { some: {} } },
    }),
  ]);

  return {
    leadsToday,
    leads7d,
    activeConversations,
    waitingHuman,
    openTasks,
    meetingsPending,
    meetingsApproved7d,
    messagesIn7d,
    messagesOut7d,
    autoHandledPct:
      convos30d > 0 ? Math.round(((convos30d - escalated30d) / convos30d) * 100) : null,
  };
}

export type AttentionItem = {
  leadId: string;
  name: string;
  reason: "task" | "meeting" | "waiting";
  detail: string;
  at: Date;
};
