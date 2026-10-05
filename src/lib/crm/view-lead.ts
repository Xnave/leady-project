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

const viewInclude = {
  channel: true,
  stageEvents: { orderBy: { createdAt: "desc" }, take: 40 },
  notes: { orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 40 },
  adminDecisionLogs: { orderBy: { createdAt: "desc" }, take: 40 },
  requests: { orderBy: { createdAt: "desc" }, take: 20 },
  hitlTasks: { orderBy: { createdAt: "desc" }, take: 40 },
  conversations: { orderBy: { createdAt: "desc" }, take: 8 },
} satisfies Prisma.LeadInclude;

/** Full lead detail for `GET /api/leads/[id]/view`. Null when the lead is not in this tenant. */
export async function loadLeadView(
  tenantId: string,
  leadId: string,
  ui: UiCopy,
  lang: UiLang,
): Promise<LeadViewDTO | null> {
  const started = Date.now();
  const now = new Date();
  const instanceLabels = await loadInstanceFieldLabels(tenantId);
  const labels = requestFieldLabels(ui, instanceLabels);

  const [lead, tenant] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, tenantId }, include: viewInclude }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
  ]);
  if (!lead || !tenant) {
    logCrmPerf("crm.load_lead_view", {
      tenantId,
      leadId,
      found: false,
      ms: Date.now() - started,
    });
    return null;
  }

  const latestConversation = lead.conversations[0] ?? null;
  const rawMessages = latestConversation
    ? await prisma.message.findMany({
        where: { tenantId, conversationId: latestConversation.id },
        orderBy: { createdAt: "desc" },
        take: 60,
      })
    : [];
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

  const timeline = groupTimelineByDay(
    buildLeadTimeline({
      stageEvents: lead.stageEvents.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        source: e.source,
        reason: e.reason,
        actorUserId: e.actorUserId,
        createdAt: e.createdAt,
      })),
      notes: lead.notes.map((n) => ({
        id: n.id,
        body: n.body,
        authorLabel: n.authorLabel,
        pinned: n.pinned,
        createdAt: n.createdAt,
      })),
      decisions: lead.adminDecisionLogs.map((d) => ({
        id: d.id,
        category: d.category,
        action: d.action,
        actorUserId: d.actorUserId,
        actorLabel: d.actorLabel,
        details: d.details,
        createdAt: d.createdAt,
      })),
      requests: lead.requests.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        timeText: r.timeText,
        createdAt: r.createdAt,
      })),
      handoffs: lead.hitlTasks
        .filter((h) => h.type !== REQUEST_APPROVAL_TASK)
        .map((h) => ({
          id: h.id,
          reason: h.reason,
          status: h.status,
          createdAt: h.createdAt,
          completedAt: h.completedAt,
          info: h.type === RESERVATION_LINK_SENT_TASK,
        })),
      conversations: lead.conversations.map((c) => ({
        id: c.id,
        status: c.status,
        lifecycleReason: c.lifecycleReason,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    }),
    tenant.timezone,
  ).map((g) => ({ day: g.day, items: g.items.map((it) => ({ ...it, at: it.at.toISOString() })) }));

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

  const dto = {
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
    details: buildDetails(fields, ui),
    requests: requestRows.map((r) => ({
      id: r.id,
      headline: [requestHeadline(r) ?? requestKindLabel(ui, r.kind), r.timeText].filter(Boolean).join(" · "),
      status: r.status,
    })),
  };
  logCrmPerf("crm.load_lead_view", {
    tenantId,
    leadId,
    found: true,
    ms: Date.now() - started,
  });
  return dto;
}
