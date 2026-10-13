/**
 * Data for the home dashboard: the "needs you" queue, the pipeline, upcoming
 * requests, the last week's activity and the latest conversations. Demo leads are
 * left out everywhere, matching the leads list's default.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { leadDisplayName } from "@/lib/leads";
import { requestHeadline } from "@/lib/request-view";
import type { UiCopy, UiLang } from "@/lib/ui";
import { toRequestRow, type CrmCounts, type LeadRowDTO } from "./view";
import { loadLeadRows } from "./view-rows";

const DAY_MS = 86_400_000;
const NOT_DEMO: Prisma.LeadWhereInput = { NOT: { externalUserId: { startsWith: "demo-" } } };

export type HomeUpcoming = {
  id: string;
  leadId: string;
  name: string;
  headline: string;
  timeText: string;
  startAt: string;
  endAt: string | null;
  status: "pending" | "approved";
};

export type HomeRecent = {
  id: string;
  name: string;
  channel: string;
  at: string;
  lastRole: string;
  lastText: string;
  unread: boolean;
};

export type HomeData = {
  needs: LeadRowDTO[];
  counts: CrmCounts;
  week: { newLeads: number; agentReplies: number; won: number; handoffs: number };
  upcoming: HomeUpcoming[];
  recent: HomeRecent[];
};

export async function loadHomeData(o: { tenantId: string; ui: UiCopy; lang: UiLang; now?: Date }): Promise<HomeData> {
  const now = o.now ?? new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  // Keep a booking that started a moment ago on the list while it is still happening.
  const upcomingFrom = new Date(now.getTime() - 2 * 3_600_000);
  const { tenantId } = o;

  const [queue, newLeads, agentReplies, won, handoffs, requests, recentLeads] = await Promise.all([
    loadLeadRows({ tenantId, tab: "needs", showDemo: false, page: 1, pageSize: 5, ui: o.ui, lang: o.lang }),
    prisma.lead.count({ where: { tenantId, ...NOT_DEMO, createdAt: { gte: weekAgo } } }),
    prisma.message.count({
      where: { tenantId, role: "agent", createdAt: { gte: weekAgo }, conversation: { lead: NOT_DEMO } },
    }),
    prisma.leadStageEvent.count({ where: { tenantId, to: "won", createdAt: { gte: weekAgo }, lead: NOT_DEMO } }),
    prisma.hitlTask.count({ where: { tenantId, createdAt: { gte: weekAgo }, lead: NOT_DEMO } }),
    prisma.request.findMany({
      where: { tenantId, status: { in: ["pending", "approved"] }, startAt: { gte: upcomingFrom }, lead: NOT_DEMO },
      orderBy: { startAt: "asc" },
      take: 5,
      include: { lead: { select: { displayName: true, externalUserId: true, fields: true } } },
    }),
    prisma.lead.findMany({
      where: { tenantId, ...NOT_DEMO, lastLeadMessageAt: { not: null } },
      orderBy: { lastLeadMessageAt: "desc" },
      take: 5,
      select: {
        id: true,
        displayName: true,
        externalUserId: true,
        fields: true,
        adminUnread: true,
        lastLeadMessageAt: true,
        channel: { select: { provider: true } },
        conversations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, text: true, createdAt: true } } },
        },
      },
    }),
  ]);

  const upcoming: HomeUpcoming[] = requests
    .filter((r): r is typeof r & { startAt: Date } => r.startAt != null)
    .map((r) => ({
      id: r.id,
      leadId: r.leadId,
      name: r.contactName.trim() || leadDisplayName(r.lead),
      headline: requestHeadline(toRequestRow(r)) ?? "",
      timeText: r.timeText.trim(),
      startAt: r.startAt.toISOString(),
      endAt: r.endAt?.toISOString() ?? null,
      status: r.status === "approved" ? "approved" : "pending",
    }));

  const recent: HomeRecent[] = recentLeads.map((l) => {
    const last = l.conversations[0]?.messages[0];
    return {
      id: l.id,
      name: leadDisplayName(l),
      channel: l.channel.provider,
      at: (last?.createdAt ?? l.lastLeadMessageAt ?? now).toISOString(),
      lastRole: last?.role ?? "lead",
      lastText: (last?.text ?? "").replace(/\s+/g, " ").trim(),
      unread: l.adminUnread,
    };
  });

  return {
    needs: queue.rows,
    counts: queue.counts,
    week: { newLeads, agentReplies, won, handoffs },
    upcoming,
    recent,
  };
}
