/** List-row loader for the CRM inbox (tabs, filters, search, pagination, counts). */
import type { Prisma } from "@prisma/client";
import { loadInstanceFieldLabels } from "@/lib/capability-instances";
import { prisma } from "@/lib/db";
import type { UiCopy, UiLang } from "@/lib/ui";
import {
  buildLeadRowDTO,
  requestFieldLabels,
  summarizeRequest,
  toRequestRow,
  type CrmCounts,
  type CrmTab,
  type LeadRowDTO,
  type LeadRowInput,
} from "./view";
import { needsWhere } from "./needs";
import { ACTIVE_STAGES, CLOSED_STAGES, FOLLOW_UP_PRIORITY, type FollowUpReason, type PipelineStage } from "./types";

function demoWhere(showDemo: boolean): Prisma.LeadWhereInput {
  return showDemo ? {} : { NOT: { externalUserId: { startsWith: "demo-" } } };
}

function tabWhere(tab: CrmTab, now: Date): Prisma.LeadWhereInput {
  switch (tab) {
    case "needs":
      return needsWhere(now);
    case "active":
      return { stage: { in: [...ACTIVE_STAGES] } };
    case "won":
      return { stage: "won" };
    case "closed":
      return { stage: { in: [...CLOSED_STAGES] } };
    case "all":
      return {};
  }
}

function searchWhere(q: string): Prisma.LeadWhereInput {
  return {
    OR: [
      { displayName: { contains: q, mode: "insensitive" } },
      { externalUserId: { contains: q, mode: "insensitive" } },
      { fields: { path: ["name"], string_contains: q, mode: "insensitive" } },
      { notes: { some: { body: { contains: q, mode: "insensitive" } } } },
    ],
  };
}

function buildRowsWhere(
  o: { tenantId: string; tab: CrmTab; stage?: PipelineStage; channel?: string; q?: string; showDemo: boolean },
  now: Date,
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { tenantId: o.tenantId, ...demoWhere(o.showDemo), ...tabWhere(o.tab, now) };
  if (o.stage) where.stage = o.stage;
  if (o.channel) where.channel = { provider: o.channel };
  const q = o.q?.trim();
  if (q) where.AND = [searchWhere(q)];
  return where;
}

async function computeCounts(tenantId: string, showDemo: boolean, now: Date): Promise<CrmCounts> {
  const base: Prisma.LeadWhereInput = { tenantId, ...demoWhere(showDemo) };
  const won30Since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [needs, active, won, closed, all, stageNew, stageTalking, stageQualified, stagePending, stageWon30] =
    await Promise.all([
      prisma.lead.count({ where: { ...base, ...needsWhere(now) } }),
      prisma.lead.count({ where: { ...base, stage: { in: [...ACTIVE_STAGES] } } }),
      prisma.lead.count({ where: { ...base, stage: "won" } }),
      prisma.lead.count({ where: { ...base, stage: { in: [...CLOSED_STAGES] } } }),
      prisma.lead.count({ where: base }),
      prisma.lead.count({ where: { ...base, stage: "new" } }),
      prisma.lead.count({ where: { ...base, stage: "talking" } }),
      prisma.lead.count({ where: { ...base, stage: "qualified" } }),
      prisma.lead.count({ where: { ...base, stage: "pending" } }),
      prisma.lead.count({ where: { ...base, stage: "won", stageChangedAt: { gte: won30Since } } }),
    ]);
  return {
    needs,
    active,
    won,
    closed,
    all,
    byStage: {
      new: stageNew,
      talking: stageTalking,
      qualified: stageQualified,
      pending: stagePending,
      won30: stageWon30,
    },
  };
}

const rowInclude = {
  channel: true,
  requests: { where: { status: { in: ["pending", "approved"] } }, orderBy: { createdAt: "desc" }, take: 1 },
  conversations: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      summary: true,
      messages: { where: { role: "lead" }, orderBy: { createdAt: "desc" }, take: 1, select: { text: true } },
    },
  },
} satisfies Prisma.LeadInclude;

type RowLead = Prisma.LeadGetPayload<{ include: typeof rowInclude }>;

function rowInput(lead: RowLead, lang: UiLang, labels: Record<string, string>): LeadRowInput {
  const request = lead.requests[0];
  const convo = lead.conversations[0];
  return {
    id: lead.id,
    displayName: lead.displayName,
    externalUserId: lead.externalUserId,
    fields: lead.fields,
    stage: lead.stage,
    stageSource: lead.stageSource,
    followUpReason: lead.followUpReason,
    followUpAt: lead.followUpAt,
    snoozedUntil: lead.snoozedUntil,
    nextStepText: lead.nextStepText,
    nextStepAt: lead.nextStepAt,
    lastLeadMessageAt: lead.lastLeadMessageAt,
    lastOutboundAt: lead.lastOutboundAt,
    updatedAt: lead.updatedAt,
    adminUnread: lead.adminUnread,
    channelProvider: lead.channel.provider,
    requestLine: request ? summarizeRequest(toRequestRow(request), lang, labels) : null,
    summary: convo?.summary?.trim() || null,
    lastLeadText: convo?.messages[0]?.text ?? null,
  };
}

/** List rows for the CRM inbox: the "needs" tab is capped at 200 and sorted in JS. */
export async function loadLeadRows(o: {
  tenantId: string;
  tab: CrmTab;
  stage?: PipelineStage;
  channel?: string;
  q?: string;
  showDemo: boolean;
  page: number;
  pageSize: number;
  ui: UiCopy;
  lang: UiLang;
}): Promise<{ rows: LeadRowDTO[]; total: number; counts: CrmCounts }> {
  const now = new Date();
  const instanceLabels = await loadInstanceFieldLabels(o.tenantId);
  const labels = requestFieldLabels(o.ui, instanceLabels);
  const where = buildRowsWhere(o, now);

  const [counts, total, leads] = await Promise.all([
    computeCounts(o.tenantId, o.showDemo, now),
    prisma.lead.count({ where }),
    o.tab === "needs"
      ? prisma.lead.findMany({ where, take: 200, include: rowInclude })
      : prisma.lead.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip: (o.page - 1) * o.pageSize,
          take: o.pageSize,
          include: rowInclude,
        }),
  ]);

  let pageLeads = leads;
  if (o.tab === "needs") {
    const sorted = [...leads].sort((a, b) => {
      const pa = FOLLOW_UP_PRIORITY.indexOf((a.followUpReason ?? "") as FollowUpReason);
      const pb = FOLLOW_UP_PRIORITY.indexOf((b.followUpReason ?? "") as FollowUpReason);
      if (pa !== pb) return pa - pb;
      const ta = a.followUpAt?.getTime() ?? 0;
      const tb = b.followUpAt?.getTime() ?? 0;
      return ta - tb;
    });
    const start = (o.page - 1) * o.pageSize;
    pageLeads = sorted.slice(start, start + o.pageSize);
  }

  const rows = pageLeads.map((lead) => buildLeadRowDTO(rowInput(lead, o.lang, labels), o.ui, now));
  return { rows, total, counts };
}
