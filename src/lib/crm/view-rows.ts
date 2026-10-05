/** List-row loader for the CRM inbox (tabs, filters, search, pagination, counts). */
import type { Prisma } from "@prisma/client";
import { loadInstanceFieldLabels } from "@/lib/capability-instances";
import { prisma } from "@/lib/db";
import type { UiCopy, UiLang } from "@/lib/ui";
import {
  buildLeadRowDTO,
  isQueueTab,
  requestFieldLabels,
  summarizeRequest,
  toRequestRow,
  type CrmCounts,
  type CrmTab,
  type LeadRowDTO,
  type LeadRowInput,
} from "./view";
import { logCrmPerf } from "@/lib/perf";
import { coldWhere, needsWhere, reasonWhere } from "./needs";
import { ACTIVE_STAGES, CLOSED_STAGES, FOLLOW_UP_PRIORITY, PIPELINE_STAGES, isPipelineStage, type FollowUpReason, type PipelineStage } from "./types";

function demoWhere(showDemo: boolean): Prisma.LeadWhereInput {
  return showDemo ? {} : { NOT: { externalUserId: { startsWith: "demo-" } } };
}

function tabWhere(tab: CrmTab, now: Date): Prisma.LeadWhereInput {
  switch (tab) {
    case "needs":
      return needsWhere(now);
    case "cold":
      return coldWhere(now);
    case "active":
      return { pipelineStage: { in: [...ACTIVE_STAGES] } };
    case "won":
      return { pipelineStage: "won" };
    case "closed":
      return { pipelineStage: { in: [...CLOSED_STAGES] } };
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
  o: { tenantId: string; tab: CrmTab; stage?: PipelineStage; reason?: FollowUpReason; channel?: string; q?: string; showDemo: boolean },
  now: Date,
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { tenantId: o.tenantId, ...demoWhere(o.showDemo), ...tabWhere(o.tab, now) };
  if (o.stage) where.pipelineStage = o.stage;
  if (o.channel) where.channel = { provider: o.channel };
  const and: Prisma.LeadWhereInput[] = [];
  if (o.reason) and.push(reasonWhere(o.reason, now));
  const q = o.q?.trim();
  if (q) and.push(searchWhere(q));
  if (and.length) where.AND = and;
  return where;
}

/** Derive tab/stage totals from one groupBy plus the queue counts. Exported for tests. */
export function countsFromStageGroups(
  groups: { pipelineStage: string; count: number }[],
  extras: { needs: number; cold: number; byReason: Record<FollowUpReason, number> },
): CrmCounts {
  const byStage = Object.fromEntries(PIPELINE_STAGES.map((st) => [st, 0])) as CrmCounts["byStage"];
  let all = 0;
  for (const g of groups) {
    all += g.count;
    if (isPipelineStage(g.pipelineStage)) byStage[g.pipelineStage] = g.count;
  }
  return {
    needs: extras.needs,
    cold: extras.cold,
    active: ACTIVE_STAGES.reduce((sum, st) => sum + byStage[st], 0),
    won: byStage.won,
    closed: CLOSED_STAGES.reduce((sum, st) => sum + byStage[st], 0),
    all,
    byStage,
    byReason: extras.byReason,
  };
}

async function computeCounts(tenantId: string, showDemo: boolean, now: Date): Promise<CrmCounts> {
  const base: Prisma.LeadWhereInput = { tenantId, ...demoWhere(showDemo) };
  const count = (where: Prisma.LeadWhereInput) => prisma.lead.count({ where });
  // cold byReason === nCold; only count the three "needs" reasons separately.
  const needsReasons = FOLLOW_UP_PRIORITY.filter((r) => r !== "cold");
  const [stageGroups, nNeeds, nCold, ...needsReasonCounts] = await Promise.all([
    prisma.lead.groupBy({
      by: ["pipelineStage"],
      where: base,
      _count: { _all: true },
    }),
    count({ ...base, ...needsWhere(now) }),
    count({ ...base, ...coldWhere(now) }),
    ...needsReasons.map((r) => count({ ...base, ...reasonWhere(r, now) })),
  ]);
  const byReason = {
    ...Object.fromEntries(needsReasons.map((r, i) => [r, needsReasonCounts[i]])),
    cold: nCold,
  } as CrmCounts["byReason"];
  return countsFromStageGroups(
    stageGroups.map((g) => ({ pipelineStage: g.pipelineStage, count: g._count._all })),
    { needs: nNeeds, cold: nCold, byReason },
  );
}

const rowInclude = {
  channel: true,
  requests: { where: { status: { in: ["pending", "approved"] } }, orderBy: { createdAt: "desc" }, take: 1 },
  conversations: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { summary: true },
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
    stage: lead.pipelineStage,
    stageSource: lead.pipelineStageSource,
    followUpReason: lead.attentionReason,
    followUpAt: lead.attentionAt,
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
    // List line uses summary / request / next-step; skip a nested message join.
    lastLeadText: null,
  };
}

/** List rows for the CRM inbox: the queue tabs (needs, cold) are capped at 200 and sorted in JS. */
export async function loadLeadRows(o: {
  tenantId: string;
  tab: CrmTab;
  stage?: PipelineStage;
  reason?: FollowUpReason;
  channel?: string;
  q?: string;
  showDemo: boolean;
  page: number;
  pageSize: number;
  ui: UiCopy;
  lang: UiLang;
  skipCounts?: boolean;
  counts?: CrmCounts;
}): Promise<{ rows: LeadRowDTO[]; total: number; counts: CrmCounts }> {
  const started = Date.now();
  const now = new Date();
  const instanceLabels = await loadInstanceFieldLabels(o.tenantId);
  const labels = requestFieldLabels(o.ui, instanceLabels);
  const where = buildRowsWhere(o, now);

  const countsPromise =
    o.skipCounts && o.counts
      ? Promise.resolve(o.counts)
      : computeCounts(o.tenantId, o.showDemo, now);

  const [counts, total, leads] = await Promise.all([
    countsPromise,
    prisma.lead.count({ where }),
    isQueueTab(o.tab)
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
  // Most urgent first: by reason priority, then the longest-waiting (for cold, the
  // WhatsApp window closes soonest).
  if (isQueueTab(o.tab)) {
    const sorted = [...leads].sort((a, b) => {
      const pa = FOLLOW_UP_PRIORITY.indexOf((a.attentionReason ?? "") as FollowUpReason);
      const pb = FOLLOW_UP_PRIORITY.indexOf((b.attentionReason ?? "") as FollowUpReason);
      if (pa !== pb) return pa - pb;
      const ta = a.attentionAt?.getTime() ?? 0;
      const tb = b.attentionAt?.getTime() ?? 0;
      return ta - tb;
    });
    const start = (o.page - 1) * o.pageSize;
    pageLeads = sorted.slice(start, start + o.pageSize);
  }

  const rows = pageLeads.map((lead) => buildLeadRowDTO(rowInput(lead, o.lang, labels), o.ui, now));
  logCrmPerf("crm.load_lead_rows", {
    tenantId: o.tenantId,
    tab: o.tab,
    row_count: rows.length,
    total,
    ms: Date.now() - started,
  });
  return { rows, total, counts };
}
