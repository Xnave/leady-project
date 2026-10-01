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
import { coldWhere, needsWhere, reasonWhere } from "./needs";
import { ACTIVE_STAGES, CLOSED_STAGES, FOLLOW_UP_PRIORITY, PIPELINE_STAGES, type FollowUpReason, type PipelineStage } from "./types";

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

async function computeCounts(tenantId: string, showDemo: boolean, now: Date): Promise<CrmCounts> {
  const base: Prisma.LeadWhereInput = { tenantId, ...demoWhere(showDemo) };
  const needs = { ...base, ...needsWhere(now) };
  const count = (where: Prisma.LeadWhereInput) => prisma.lead.count({ where });
  const [nNeeds, nCold, nActive, nWon, nClosed, nAll, stages, reasons] = await Promise.all([
    count(needs),
    count({ ...base, ...coldWhere(now) }),
    count({ ...base, pipelineStage: { in: [...ACTIVE_STAGES] } }),
    count({ ...base, pipelineStage: "won" }),
    count({ ...base, pipelineStage: { in: [...CLOSED_STAGES] } }),
    count(base),
    Promise.all(PIPELINE_STAGES.map((st) => count({ ...base, pipelineStage: st }))),
    Promise.all(FOLLOW_UP_PRIORITY.map((r) => count({ ...base, ...reasonWhere(r, now) }))),
  ]);
  return {
    needs: nNeeds,
    cold: nCold,
    active: nActive,
    won: nWon,
    closed: nClosed,
    all: nAll,
    byStage: Object.fromEntries(PIPELINE_STAGES.map((st, i) => [st, stages[i]])) as CrmCounts["byStage"],
    byReason: Object.fromEntries(FOLLOW_UP_PRIORITY.map((r, i) => [r, reasons[i]])) as CrmCounts["byReason"],
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
    lastLeadText: convo?.messages[0]?.text ?? null,
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
}): Promise<{ rows: LeadRowDTO[]; total: number; counts: CrmCounts }> {
  const now = new Date();
  const instanceLabels = await loadInstanceFieldLabels(o.tenantId);
  const labels = requestFieldLabels(o.ui, instanceLabels);
  const where = buildRowsWhere(o, now);

  const [counts, total, leads] = await Promise.all([
    computeCounts(o.tenantId, o.showDemo, now),
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
  return { rows, total, counts };
}
