/** Full lead-view loader: profile, activity timeline, latest thread, requests, notes. */
import type { Prisma } from "@prisma/client";
import { isBookingSessionKey } from "@/lib/flow/booking";
import { loadInstanceFieldLabels } from "@/lib/capability-instances";
import { prisma } from "@/lib/db";
import {
  formatPhoneDisplay,
  instagramProfileUrl,
  leadInstagramUsername,
  whatsappChatUrl,
} from "@/lib/leads";
import { logCrmPerf } from "@/lib/perf";
import { REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { RESERVATION_LINK_SENT_TASK } from "@/lib/reservations";
import { requestHeadline, requestSummaryLines, requestTimeShape } from "@/lib/request-view";
import type { UiCopy, UiLang } from "@/lib/ui";
import { hitlReasonLabel, intentLabel, leadFieldLabel, requestKindLabel } from "@/lib/ui/labels";
import { buildLeadTimeline, groupTimelineByDay } from "./timeline";
import { buildLeadRowDTO, requestFieldLabels, summarizeRequest, toRequestRow, type LeadViewDTO, type OpenTaskDTO } from "./view";

export type LeadViewScope = "lite" | "full";

const HIDDEN_DETAIL_KEYS = new Set([
  "instagramUsername",
  "zernioConversationId",
  "staff_slot_offer",
  "staff_date_offer",
  "time_preference",
  "name_collected_by_agent",
  "force_fresh_inbound",
  "meetingId",
]);

const DETAIL_PRIMARY_KEYS = ["name", "phone", "email", "intent"] as const;

/** Mirrors `CapturedFieldsBlock`: name/phone/email/intent first, then other captured string fields. */
function buildDetails(fields: Record<string, unknown>, ui: UiCopy): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const key of DETAIL_PRIMARY_KEYS) {
    const raw = fields[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const value = key === "phone" ? formatPhoneDisplay(raw) : key === "intent" ? intentLabel(ui, raw) : raw;
    out.push({ label: leadFieldLabel(ui, key), value });
  }
  for (const [key, raw] of Object.entries(fields)) {
    if ((DETAIL_PRIMARY_KEYS as readonly string[]).includes(key)) continue;
    if (HIDDEN_DETAIL_KEYS.has(key)) continue;
    if (isBookingSessionKey(key)) continue;
    if (typeof raw !== "string" || !raw.trim()) continue;
    out.push({ label: leadFieldLabel(ui, key), value: raw });
  }
  return out;
}

const notesArgs = {
  orderBy: [{ pinned: "desc" as const }, { createdAt: "desc" as const }],
  take: 40,
  select: {
    id: true,
    body: true,
    authorLabel: true,
    pinned: true,
    createdAt: true,
  },
};

const requestsArgs = {
  orderBy: { createdAt: "desc" as const },
  take: 20,
  select: {
    id: true,
    tenantId: true,
    leadId: true,
    conversationId: true,
    capabilityId: true,
    kind: true,
    status: true,
    startAt: true,
    endAt: true,
    timeText: true,
    contactName: true,
    contactEmail: true,
    contactPhone: true,
    data: true,
    quotedTotal: true,
    decidedBy: true,
    decidedAt: true,
    createdAt: true,
  },
};

const hitlArgs = {
  orderBy: { createdAt: "desc" as const },
  take: 40,
  select: {
    id: true,
    type: true,
    reason: true,
    status: true,
    payload: true,
    createdAt: true,
    completedAt: true,
  },
};

function conversationsArgs(take: number) {
  return {
    orderBy: { createdAt: "desc" as const },
    take,
    select: {
      id: true,
      status: true,
      lifecycleReason: true,
      summary: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "desc" as const },
        take: 60,
        select: { id: true, role: true, text: true, createdAt: true },
      },
    },
  };
}

const leadCore = {
  id: true,
  displayName: true,
  externalUserId: true,
  fields: true,
  pipelineStage: true,
  pipelineStageSource: true,
  pipelineStageReason: true,
  pipelineStageChangedAt: true,
  attentionReason: true,
  attentionAt: true,
  snoozedUntil: true,
  nextStepText: true,
  nextStepAt: true,
  lastLeadMessageAt: true,
  lastOutboundAt: true,
  updatedAt: true,
  adminUnread: true,
  channel: { select: { provider: true } },
  notes: notesArgs,
  requests: requestsArgs,
  hitlTasks: hitlArgs,
};

/** Chat-first peek: one thread, no timeline joins. */
const liteSelect = {
  ...leadCore,
  conversations: conversationsArgs(1),
} satisfies Prisma.LeadSelect;

/** Full page / Activity tab: timeline relations + up to 8 conversations. */
const fullSelect = {
  ...leadCore,
  stageEvents: {
    orderBy: { createdAt: "desc" as const },
    take: 40,
    select: {
      id: true,
      from: true,
      to: true,
      source: true,
      reason: true,
      actorUserId: true,
      createdAt: true,
    },
  },
  adminDecisionLogs: {
    orderBy: { createdAt: "desc" as const },
    take: 40,
    select: {
      id: true,
      category: true,
      action: true,
      actorUserId: true,
      actorLabel: true,
      details: true,
      createdAt: true,
    },
  },
  conversations: conversationsArgs(8),
} satisfies Prisma.LeadSelect;

/** Full lead detail for `GET /api/leads/[id]/view`. Null when the lead is not in this tenant. */
export async function loadLeadView(
  tenantId: string,
  leadId: string,
  ui: UiCopy,
  lang: UiLang,
  scope: LeadViewScope = "full",
): Promise<LeadViewDTO | null> {
  const started = Date.now();
  const now = new Date();
  const select = scope === "lite" ? liteSelect : fullSelect;

  let labelsMs = 0;
  let leadMs = 0;
  const labelsP = (async () => {
    const t0 = Date.now();
    const instanceLabels = await loadInstanceFieldLabels(tenantId);
    labelsMs = Date.now() - t0;
    return instanceLabels;
  })();
  const leadP = (async () => {
    const t0 = Date.now();
    const row = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select,
    });
    leadMs = Date.now() - t0;
    return row;
  })();
  const tenantP = prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });

  const [instanceLabels, lead, tenant] = await Promise.all([labelsP, leadP, tenantP]);
  const labels = requestFieldLabels(ui, instanceLabels);

  if (!lead || !tenant) {
    logCrmPerf("crm.load_lead_view", {
      tenantId,
      leadId,
      scope,
      found: false,
      labels_ms: labelsMs,
      lead_ms: leadMs,
      messages_ms: 0,
      ms: Date.now() - started,
    });
    return null;
  }

  const latestConversation = lead.conversations[0] ?? null;
  const rawMessages = latestConversation?.messages ?? [];
  const messages = [...rawMessages].reverse();
  const lastLeadText = rawMessages.find((m) => m.role === "lead")?.text ?? null;

  const requestRows = lead.requests.map(toRequestRow);
  const activeRequest = requestRows.find((r) => r.status === "pending" || r.status === "approved") ?? null;
  const requestLine = activeRequest ? summarizeRequest(activeRequest, lang, labels) : null;

  const row = buildLeadRowDTO(
    {
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
      requestLine,
      summary: latestConversation?.summary?.trim() || null,
      interest:
        typeof (lead.fields as Record<string, unknown> | null)?.interest === "string"
          ? String((lead.fields as Record<string, unknown>).interest).trim() || null
          : null,
      lastLeadText,
    },
    ui,
    now,
  );

  const fields = (lead.fields ?? {}) as Record<string, unknown>;
  const phone =
    (typeof fields.phone === "string" && fields.phone) ||
    (lead.channel.provider === "whatsapp" ? lead.externalUserId : "");
  const igHandle = lead.channel.provider === "instagram" ? leadInstagramUsername(fields) : "";

  const timeline =
    scope === "full"
      ? (() => {
          const full = lead as typeof lead & {
            stageEvents: {
              id: string;
              from: string;
              to: string;
              source: string;
              reason: string;
              actorUserId: string | null;
              createdAt: Date;
            }[];
            adminDecisionLogs: {
              id: string;
              category: string;
              action: string;
              actorUserId: string;
              actorLabel: string;
              details: unknown;
              createdAt: Date;
            }[];
          };
          return groupTimelineByDay(
            buildLeadTimeline({
              stageEvents: full.stageEvents.map((e) => ({
                id: e.id,
                from: e.from,
                to: e.to,
                source: e.source,
                reason: e.reason,
                actorUserId: e.actorUserId,
                createdAt: e.createdAt,
              })),
              notes: full.notes.map((n) => ({
                id: n.id,
                body: n.body,
                authorLabel: n.authorLabel,
                pinned: n.pinned,
                createdAt: n.createdAt,
              })),
              decisions: full.adminDecisionLogs.map((d) => ({
                id: d.id,
                category: d.category,
                action: d.action,
                actorUserId: d.actorUserId,
                actorLabel: d.actorLabel,
                details: d.details,
                createdAt: d.createdAt,
              })),
              requests: full.requests.map((r) => ({
                id: r.id,
                kind: r.kind,
                status: r.status,
                timeText: r.timeText,
                createdAt: r.createdAt,
              })),
              handoffs: full.hitlTasks
                .filter((h) => h.type !== REQUEST_APPROVAL_TASK)
                .map((h) => ({
                  id: h.id,
                  reason: h.reason,
                  status: h.status,
                  createdAt: h.createdAt,
                  completedAt: h.completedAt,
                  info: h.type === RESERVATION_LINK_SENT_TASK,
                })),
              conversations: full.conversations.map((c) => ({
                id: c.id,
                status: c.status,
                lifecycleReason: c.lifecycleReason,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
              })),
            }),
            tenant.timezone,
          ).map((g) => ({ day: g.day, items: g.items.map((it) => ({ ...it, at: it.at.toISOString() })) }));
        })()
      : [];

  // The task the owner acts on here: an open handoff first (the chat is paused), else an approval.
  const open = lead.hitlTasks.filter((t) => t.status === "open" && t.type !== RESERVATION_LINK_SENT_TASK);
  const task = open.find((t) => t.type !== REQUEST_APPROVAL_TASK) ?? open.find((t) => t.type === REQUEST_APPROVAL_TASK) ?? null;
  let openTask: OpenTaskDTO | null = null;
  if (task) {
    const payload = (task.payload ?? {}) as { requestId?: string; summary?: string; awaitingCustomerConfirm?: boolean };
    const req = task.type === REQUEST_APPROVAL_TASK ? requestRows.find((r) => r.id === payload.requestId) ?? null : null;
    openTask = {
      id: task.id,
      kind: task.type === REQUEST_APPROVAL_TASK ? "approval" : "handoff",
      reason: task.type === REQUEST_APPROVAL_TASK ? "" : hitlReasonLabel(ui, task.reason),
      summary: typeof payload.summary === "string" ? payload.summary : "",
      createdAt: task.createdAt.toISOString(),
      awaitingCustomer: Boolean(payload.awaitingCustomerConfirm),
      request: req
        ? {
            id: req.id,
            timeShape: requestTimeShape(req),
            headline: requestHeadline(req) ?? requestKindLabel(ui, req.kind),
            timeText: req.timeText.trim(),
            lines: requestSummaryLines({
              request: req,
              lang,
              labels,
              // The CRM record wins when the lead updated their details later.
              overrides: {
                name: typeof fields.name === "string" ? fields.name : undefined,
                phone: typeof fields.phone === "string" ? fields.phone : undefined,
                email: typeof fields.email === "string" ? fields.email : undefined,
              },
            }),
          }
        : null,
    };
  }

  const dto: LeadViewDTO = {
    ...row,
    openTask,
    phone: formatPhoneDisplay(phone),
    email: typeof fields.email === "string" ? fields.email : "",
    waUrl: lead.channel.provider === "whatsapp" ? whatsappChatUrl(phone) : "",
    igUrl: igHandle ? instagramProfileUrl(igHandle) : "",
    stageReason: lead.pipelineStageReason,
    stageChangedAt: lead.pipelineStageChangedAt.toISOString(),
    notes: lead.notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorLabel: n.authorLabel,
      pinned: n.pinned,
      createdAt: n.createdAt.toISOString(),
    })),
    timeline,
    conversationId: latestConversation?.id ?? null,
    conversationStatus: latestConversation?.status ?? null,
    messages: messages.map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt.toISOString() })),
    details: scope === "full" ? buildDetails(fields, ui) : [],
    requests:
      scope === "full"
        ? requestRows.map((r) => ({
            id: r.id,
            headline: [requestHeadline(r) ?? requestKindLabel(ui, r.kind), r.timeText].filter(Boolean).join(" · "),
            status: r.status,
          }))
        : [],
  };
  logCrmPerf("crm.load_lead_view", {
    tenantId,
    leadId,
    scope,
    found: true,
    labels_ms: labelsMs,
    lead_ms: leadMs,
    messages_ms: 0,
    ms: Date.now() - started,
  });
  return dto;
}
