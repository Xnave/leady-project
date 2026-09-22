/**
 * The one primitive behind every approval vertical.
 *
 * A request is: collected field values, a normalized time spine, a pending row, a
 * HITL task for a human, and a logged decision. A visit, a stay, a dress fitting and
 * an equipment rental are all this — they differ in `kind`, in whether the time spine
 * is a point or a span, and in the typed values in `data`.
 *
 * Vertical-specific wording still lives with each capability; everything structural
 * lives here.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveActorLabel } from "@/lib/admin-decisions";
import { normalizeSlot } from "@/lib/flow/slot";

/** HITL task type for every approval vertical. */
export const REQUEST_APPROVAL_TASK = "request_approval";
/** AdminDecisionLog category for every approval vertical. */
export const REQUEST_DECISION_CATEGORY = "request";

/** Whether a vertical's time dimension is an instant or a range. */
export type RequestTimeShape = "point" | "span";

export type RequestDecision = "approve" | "decline" | "reschedule";

export type RequestData = Record<string, unknown>;

export type RequestRow = {
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
  data: RequestData;
  quotedTotal: number | null;
  decidedBy: string | null;
  decidedAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** When no time can be resolved, approved requests stay relevant this long after the decision. */
const APPROVED_FALLBACK_RELEVANCE_MS = 2 * DAY_MS;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date-only values are stored at noon UTC so the calendar date survives any
 * timezone the reader is in.
 */
export function isoDateToUtc(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

export function utcToIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse free-text day/time wording into a point on the spine, when possible. */
export function timeTextToStartAt(
  timeText: string,
  opts?: { now?: Date },
): Date | null {
  const text = timeText.trim();
  if (!text) return null;
  const now = opts?.now ?? new Date();
  const he = normalizeSlot(text, { now, lang: "he" });
  const parsed = he.dateIso ? he : normalizeSlot(text, { now, lang: "en" });
  if (!parsed.dateIso) return null;
  return new Date(`${parsed.dateIso}T${parsed.time ?? "12:00"}:00.000Z`);
}

/**
 * Whether talk should still treat this request as an active follow-up thread.
 * Pending = yes. Declined = no. Approved = through the end of its last day.
 */
export function isRequestStillRelevant(
  request: {
    status: string;
    startAt?: Date | string | null;
    endAt?: Date | string | null;
    timeText?: string | null;
    decidedAt?: Date | string | null;
    updatedAt?: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  if (request.status === "pending") return true;
  if (request.status !== "approved") return false;

  const last = toDate(request.endAt) ?? toDate(request.startAt);
  if (last) return now.getTime() <= endOfDay(last).getTime();

  // No spine (legacy row, or wording we could not parse) — try the wording, then age out.
  const fromText = request.timeText
    ? timeTextToStartAt(request.timeText, { now })
    : null;
  if (fromText) return now.getTime() <= endOfDay(fromText).getTime();

  const stamp = toDate(request.decidedAt) ?? toDate(request.updatedAt);
  if (!stamp) return false;
  return now.getTime() - stamp.getTime() <= APPROVED_FALLBACK_RELEVANCE_MS;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(ISO_DATE.test(v) ? `${v}T12:00:00.000Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** End of the calendar day the instant falls on, in the reader's local zone. */
function endOfDay(d: Date): Date {
  const iso = utcToIsoDate(d);
  return new Date(`${iso}T23:59:59.999`);
}

function asData(raw: unknown): RequestData {
  return raw && typeof raw === "object" ? (raw as RequestData) : {};
}

function toRow(row: {
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
  return { ...row, data: asData(row.data) };
}

/** The lead's newest still-relevant request for a capability, if any. */
export async function loadRecentRequest(opts: {
  tenantId: string;
  leadId: string;
  capabilityId: string;
  now?: Date;
}): Promise<RequestRow | undefined> {
  const candidates = await prisma.request.findMany({
    where: {
      tenantId: opts.tenantId,
      leadId: opts.leadId,
      capabilityId: opts.capabilityId,
      status: { in: ["pending", "approved"] },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 8,
  });
  const row = candidates.find((r) => isRequestStillRelevant(r, opts.now));
  return row ? toRow(row) : undefined;
}

/** True when the lead has any still-relevant request in any capability. */
export async function hasRelevantRequest(opts: {
  tenantId: string;
  leadId: string;
  now?: Date;
}): Promise<boolean> {
  const candidates = await prisma.request.findMany({
    where: {
      tenantId: opts.tenantId,
      leadId: opts.leadId,
      status: { in: ["pending", "approved"] },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 16,
  });
  return candidates.some((r) => isRequestStillRelevant(r, opts.now));
}

export async function findPendingRequest(opts: {
  tenantId: string;
  conversationId: string;
  capabilityId: string;
}): Promise<RequestRow | undefined> {
  const row = await prisma.request.findFirst({
    where: {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      capabilityId: opts.capabilityId,
      status: "pending",
    },
  });
  return row ? toRow(row) : undefined;
}

export async function getRequest(opts: {
  tenantId: string;
  requestId: string;
}): Promise<RequestRow | undefined> {
  const row = await prisma.request.findFirst({
    where: { id: opts.requestId, tenantId: opts.tenantId },
  });
  return row ? toRow(row) : undefined;
}

/** Create a pending request and open the approval task for a human, atomically. */
export async function createRequestWithApprovalTask(opts: {
  tenantId: string;
  leadId: string;
  conversationId: string;
  capabilityId: string;
  kind: string;
  startAt?: Date | null;
  endAt?: Date | null;
  timeText?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  data?: RequestData;
  quotedTotal?: number | null;
  /** Extra payload for the operator's task card, merged over the derived fields. */
  taskPayload?: Record<string, unknown>;
}): Promise<RequestRow> {
  const created = await prisma.request.create({
    data: {
      tenantId: opts.tenantId,
      leadId: opts.leadId,
      conversationId: opts.conversationId,
      capabilityId: opts.capabilityId,
      kind: opts.kind,
      status: "pending",
      startAt: opts.startAt ?? null,
      endAt: opts.endAt ?? null,
      timeText: opts.timeText ?? "",
      contactName: opts.contactName ?? "",
      contactEmail: opts.contactEmail ?? "",
      contactPhone: opts.contactPhone ?? "",
      data: (opts.data ?? {}) as Prisma.InputJsonValue,
      quotedTotal: opts.quotedTotal ?? null,
    },
  });

  await prisma.hitlTask.create({
    data: {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      leadId: opts.leadId,
      type: REQUEST_APPROVAL_TASK,
      reason: REQUEST_APPROVAL_TASK,
      status: "open",
      payload: {
        requestId: created.id,
        capabilityId: opts.capabilityId,
        kind: opts.kind,
        timeText: opts.timeText ?? "",
        name: opts.contactName ?? "",
        phone: opts.contactPhone ?? "",
        email: opts.contactEmail ?? "",
        data: opts.data ?? {},
        ...(opts.taskPayload ?? {}),
      } as Prisma.InputJsonValue,
    },
  });

  return toRow(created);
}

/**
 * Record a decision on a request: update the row, resolve only the HITL tasks that
 * point at *this* request, and append to the decision log — in one transaction.
 *
 * `reschedule` keeps the request pending (the customer has not accepted yet) and
 * leaves the task open awaiting their confirmation.
 */
export async function decideRequest(opts: {
  tenantId: string;
  request: RequestRow;
  actorUserId: string;
  decision: RequestDecision;
  note?: string;
  customReply?: string;
  /** Alternative time spine offered with a reschedule. */
  alternative?: { startAt?: Date | null; endAt?: Date | null; timeText?: string };
  customerConfirmed?: boolean;
  /** Extra detail recorded on the decision log entry. */
  logDetails?: Record<string, unknown>;
  now?: Date;
}): Promise<void> {
  const { request } = opts;
  const approved = opts.decision === "approve";
  const reschedule = opts.decision === "reschedule";
  const now = opts.now ?? new Date();
  const alt = opts.alternative;
  const hasAlt = Boolean(reschedule && alt && (alt.startAt || alt.timeText));
  const actorLabel = resolveActorLabel(opts.actorUserId);

  // Scope task resolution to this request: a conversation can hold several pending
  // requests, and deciding one must not silently resolve the others.
  const tasks = await prisma.hitlTask.findMany({
    where: {
      tenantId: opts.tenantId,
      conversationId: request.conversationId,
      type: REQUEST_APPROVAL_TASK,
    },
  });
  const related = tasks.filter(
    (t) => (t.payload as { requestId?: string })?.requestId === request.id,
  );

  const nextTimeText = hasAlt ? (alt?.timeText ?? request.timeText) : request.timeText;

  await prisma.$transaction([
    prisma.request.update({
      where: { id: request.id },
      data: {
        status: approved ? "approved" : reschedule ? "pending" : "rejected",
        decidedBy: approved || !reschedule ? opts.actorUserId : request.decidedBy,
        decidedAt: approved || !reschedule ? now : request.decidedAt,
        timeText: nextTimeText,
        ...(hasAlt
          ? { startAt: alt?.startAt ?? request.startAt, endAt: alt?.endAt ?? null }
          : {}),
      },
    }),
    prisma.adminDecisionLog.create({
      data: {
        tenantId: opts.tenantId,
        leadId: request.leadId,
        conversationId: request.conversationId,
        category: REQUEST_DECISION_CATEGORY,
        action: opts.decision,
        actorUserId: opts.actorUserId,
        actorLabel,
        summary: "",
        details: {
          requestId: request.id,
          capabilityId: request.capabilityId,
          kind: request.kind,
          previousTimeText: request.timeText,
          timeText: nextTimeText,
          note: opts.note?.trim() ?? "",
          customReply: opts.customReply?.trim() ?? "",
          customerConfirmed: Boolean(opts.customerConfirmed),
          ...(opts.logDetails ?? {}),
        } as Prisma.InputJsonValue,
        createdAt: now,
      },
    }),
    ...related.map((t) => {
      const payload = (t.payload as Record<string, unknown>) ?? {};
      if (reschedule) {
        return prisma.hitlTask.update({
          where: { id: t.id },
          data: {
            status: "open",
            completedBy: null,
            completedAt: null,
            resolution: {
              decision: "reschedule",
              awaitingCustomerConfirm: true,
              requestId: request.id,
              previousTimeText: request.timeText,
              timeText: nextTimeText,
              note: opts.note ?? "",
              updatedAt: now.toISOString(),
            } as Prisma.InputJsonValue,
            payload: {
              ...payload,
              requestId: request.id,
              timeText: nextTimeText,
              previousTimeText: request.timeText,
              awaitingCustomerConfirm: true,
            } as Prisma.InputJsonValue,
          },
        });
      }
      return prisma.hitlTask.update({
        where: { id: t.id },
        data: {
          status: "done",
          completedBy: opts.actorUserId,
          completedAt: t.completedAt ?? now,
          payload: {
            ...payload,
            awaitingCustomerConfirm: false,
          } as Prisma.InputJsonValue,
          resolution: {
            approved,
            decision: opts.decision,
            requestId: request.id,
            note: opts.note ?? "",
            customReply: opts.customReply ?? "",
            customerConfirmed: Boolean(opts.customerConfirmed),
            awaitingCustomerConfirm: false,
            updatedAt: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }),
  ]);
}

/** Move a request onto a new time spine without changing its decision state. */
export async function retimeRequest(opts: {
  tenantId: string;
  requestId: string;
  startAt?: Date | null;
  endAt?: Date | null;
  timeText?: string;
  status?: string;
}): Promise<void> {
  await prisma.request.updateMany({
    where: { id: opts.requestId, tenantId: opts.tenantId },
    data: {
      ...(opts.startAt !== undefined ? { startAt: opts.startAt } : {}),
      ...(opts.endAt !== undefined ? { endAt: opts.endAt } : {}),
      ...(opts.timeText !== undefined ? { timeText: opts.timeText } : {}),
      ...(opts.status !== undefined ? { status: opts.status } : {}),
    },
  });
}

/** Merge new typed values into a request's `data`. */
export async function updateRequestData(opts: {
  tenantId: string;
  requestId: string;
  patch: RequestData;
}): Promise<void> {
  const current = await getRequest({
    tenantId: opts.tenantId,
    requestId: opts.requestId,
  });
  if (!current) return;
  await prisma.request.updateMany({
    where: { id: opts.requestId, tenantId: opts.tenantId },
    data: { data: { ...current.data, ...opts.patch } as Prisma.InputJsonValue },
  });
}
