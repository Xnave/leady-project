/**
 * `whereItStands`, the DTO shapes, and the small pieces shared by the two
 * loaders. Loading itself needs Prisma and lives in `view-rows.ts` (list rows)
 * and `view-lead.ts` (one lead's full view) — this file was pushing 300 lines
 * once both were inline, so they were split out and are re-exported here to
 * keep `loadLeadRows` / `loadLeadView` importable from `@/lib/crm/view`.
 */
import type { RequestRow } from "@/lib/requests";
import { requestSummaryLines } from "@/lib/request-view";
import { isDemoLead, formatPhoneDisplay, leadDisplayName, leadInstagramUsername } from "@/lib/leads";
import type { UiCopy, UiLang } from "@/lib/ui";
import { intentLabel } from "@/lib/ui/labels";
import type { TimelineItem } from "./timeline";
import { isFollowUpDue, waWindow } from "./followup";
import { isFollowUpReason, isPipelineStage, type FollowUpReason, type PipelineStage } from "./types";

/** Where a lead stands, in one line: the strongest available signal wins. Pure. */
export function whereItStands(i: {
  nextStepText: string | null;
  requestLine: string | null;
  summary: string | null;
  intentLabel: string | null;
  lastLeadText: string | null;
}): string {
  if (i.nextStepText?.trim()) return i.nextStepText.trim();
  if (i.requestLine?.trim()) return i.requestLine.trim();
  if (i.summary?.trim()) return i.summary.trim();
  const msg = i.lastLeadText?.trim() ?? "";
  const cut = msg.length > 60 ? `${msg.slice(0, 60)}…` : msg;
  return [i.intentLabel, cut].filter(Boolean).join(" · ");
}

export type CrmTab = "needs" | "active" | "won" | "closed" | "all";

export type CrmCounts = {
  needs: number;
  active: number;
  won: number;
  closed: number;
  all: number;
  byStage: Record<"new" | "talking" | "qualified" | "pending" | "won30", number>;
};

export type LeadRowDTO = {
  id: string;
  name: string;
  handle: string;
  channel: "whatsapp" | "instagram" | string;
  stage: PipelineStage;
  stageSource: string;
  followUpReason: FollowUpReason | null;
  followUpAt: string | null;
  due: boolean;
  snoozedUntil: string | null;
  nextStepText: string | null;
  nextStepAt: string | null;
  stand: string;
  lastAt: string;
  lastBy: "them" | "us";
  windowHoursLeft: number | null;
  windowClosed: boolean;
  unread: boolean;
  demo: boolean;
  intent: string | null;
};

export type LeadViewDTO = LeadRowDTO & {
  phone: string;
  email: string;
  waUrl: string;
  igUrl: string;
  stageReason: string;
  stageChangedAt: string;
  notes: { id: string; body: string; authorLabel: string; pinned: boolean; createdAt: string }[];
  timeline: { day: string; items: (Omit<TimelineItem, "at"> & { at: string })[] }[];
  conversationId: string | null;
  messages: { id: string; role: string; text: string; createdAt: string }[];
  details: { label: string; value: string }[];
  requests: { id: string; headline: string; status: string }[];
};

/** Same field-label map `leads/[id]/page.tsx` passes to `requestSummaryLines`. */
export function requestFieldLabels(ui: UiCopy, instanceLabels: Record<string, string>): Record<string, string> {
  return {
    need: ui.common.need,
    name: ui.common.name,
    phone: ui.common.phone,
    email: ui.common.email,
    guests: ui.reservation.guests,
    unit: ui.reservation.unit,
    ...instanceLabels,
  };
}

export function toRequestRow(r: {
  id: string;
  tenantId: string;
  leadId: string;
  conversationId: string;
  capabilityId: string;
  kind: string;
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  timeText: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  data: unknown;
  quotedTotal: number | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}): RequestRow {
  return {
    ...r,
    data: r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {},
  };
}

export function summarizeRequest(request: RequestRow, lang: UiLang, labels: Record<string, string>): string {
  return requestSummaryLines({ request, lang, labels })
    .map((line) => line.value)
    .filter(Boolean)
    .join(" · ");
}

/** Normalized inputs shared by both loaders, independent of the Prisma `include` shape each uses. */
export type LeadRowInput = {
  id: string;
  displayName: string | null;
  externalUserId: string;
  fields: unknown;
  stage: string;
  stageSource: string;
  followUpReason: string | null;
  followUpAt: Date | null;
  snoozedUntil: Date | null;
  nextStepText: string | null;
  nextStepAt: Date | null;
  lastLeadMessageAt: Date | null;
  lastOutboundAt: Date | null;
  updatedAt: Date;
  adminUnread: boolean;
  channelProvider: string;
  requestLine: string | null;
  summary: string | null;
  lastLeadText: string | null;
};

export function buildLeadRowDTO(i: LeadRowInput, ui: UiCopy, now: Date): LeadRowDTO {
  const fields = (i.fields ?? {}) as Record<string, unknown>;
  const demo = isDemoLead(i.externalUserId);
  const phone =
    (typeof fields.phone === "string" && fields.phone) || (i.channelProvider === "whatsapp" ? i.externalUserId : "");
  const igHandle = i.channelProvider === "instagram" ? leadInstagramUsername(fields) : "";
  const handle =
    i.channelProvider === "whatsapp" ? formatPhoneDisplay(phone) : igHandle ? `@${igHandle}` : i.externalUserId;
  const intent = typeof fields.intent === "string" && fields.intent ? intentLabel(ui, fields.intent) : null;
  const stage = isPipelineStage(i.stage) ? i.stage : "new";
  const followUpReason = isFollowUpReason(i.followUpReason) ? i.followUpReason : null;
  const win = i.channelProvider === "whatsapp" ? waWindow(i.lastLeadMessageAt, now) : { hoursLeft: null, closed: false };
  const lastAt =
    [i.lastLeadMessageAt, i.lastOutboundAt]
      .filter((d): d is Date => d != null)
      .reduce<Date | null>((max, d) => (!max || d.getTime() > max.getTime() ? d : max), null) ?? i.updatedAt;
  const leadTime = i.lastLeadMessageAt?.getTime() ?? -Infinity;
  const outTime = i.lastOutboundAt?.getTime() ?? -Infinity;

  return {
    id: i.id,
    name: leadDisplayName({ displayName: i.displayName, externalUserId: i.externalUserId, fields }),
    handle,
    channel: i.channelProvider,
    stage,
    stageSource: i.stageSource,
    followUpReason,
    followUpAt: i.followUpAt?.toISOString() ?? null,
    due: isFollowUpDue({ reason: followUpReason, at: i.followUpAt, snoozedUntil: i.snoozedUntil }, now),
    snoozedUntil: i.snoozedUntil?.toISOString() ?? null,
    nextStepText: i.nextStepText,
    nextStepAt: i.nextStepAt?.toISOString() ?? null,
    stand: whereItStands({
      nextStepText: i.nextStepText,
      requestLine: i.requestLine,
      summary: i.summary,
      intentLabel: intent,
      lastLeadText: i.lastLeadText,
    }),
    lastAt: lastAt.toISOString(),
    lastBy: leadTime >= outTime ? "them" : "us",
    windowHoursLeft: win.hoursLeft,
    windowClosed: win.closed,
    unread: i.adminUnread,
    demo,
    intent,
  };
}

export { loadLeadRows } from "./view-rows";
export { loadLeadView } from "./view-lead";
