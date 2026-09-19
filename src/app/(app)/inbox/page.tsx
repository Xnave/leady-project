import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import {
  RequestDecisionForm,
  type RequestDecisionLabels,
} from "@/components/RequestDecisionForm";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { enrichInstagramLeadIdentity } from "@/lib/conversations";
import {
  formatPhoneDisplay,
  instagramProfileUrl,
  leadDisplayName,
  leadInstagramUsername,
  whatsappChatUrl,
} from "@/lib/leads";
import { requireTenantIdForPage } from "@/lib/tenant";
import { loadInstanceFieldLabels } from "@/lib/capability-instances";
import { REQUEST_APPROVAL_TASK, type RequestRow } from "@/lib/requests";
import {
  requestHeadline,
  requestSummaryLines,
  requestTimeDisplay,
  requestTimeShape,
} from "@/lib/request-view";
import { fillUi, hitlReasonLabel, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

type InboxTask = Awaited<ReturnType<typeof loadInboxTasks>>[number];
type Ui = ReturnType<typeof uiCopy>;

const TASK_INCLUDE = {
  lead: {
    include: {
      channel: true,
      requests: { orderBy: { createdAt: "desc" }, take: 10 },
      conversations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  },
  conversation: true,
} as const;

async function loadInboxTasks(tenantId: string) {
  return prisma.hitlTask.findMany({
    where: {
      tenantId,
      OR: [{ status: "open" }, { type: REQUEST_APPROVAL_TASK }],
    },
    include: TASK_INCLUDE,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

/** Approval tasks carry the request id; everything else is a general HITL task. */
function taskRequestId(task: InboxTask): string | undefined {
  if (task.type !== REQUEST_APPROVAL_TASK) return undefined;
  const payload = task.payload as { requestId?: string };
  return payload.requestId;
}

function taskRequest(task: InboxTask): RequestRow | undefined {
  const id = taskRequestId(task);
  if (!id) return undefined;
  const row = task.lead.requests.find((r) => r.id === id);
  if (!row) return undefined;
  return {
    ...row,
    data: (row.data && typeof row.data === "object"
      ? (row.data as Record<string, unknown>)
      : {}) as RequestRow["data"],
  };
}

/** Per-capability wording, so the inbox reads naturally for each vertical. */
function requestTaskTitle(ui: Ui, request: RequestRow | undefined): string {
  if (!request) return ui.inbox.generalTask;
  return request.capabilityId === "reservations"
    ? ui.inbox.reservationApproval
    : ui.inbox.bookingApproval;
}

function statusLabel(ui: Ui, request: RequestRow): string {
  const decided =
    request.capabilityId === "reservations" ? ui.reservation : ui.meeting;
  if (request.status === "pending") return ui.common.pending;
  if (request.status === "approved") return decided.approved;
  if (request.status === "rejected") return decided.rejected;
  return request.status;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const { task: taskParam } = await searchParams;
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [tasks, instanceLabels] = await Promise.all([
    loadInboxTasks(tenantId),
    loadInstanceFieldLabels(tenantId),
  ]);
  const openTasks = tasks.filter((t) => t.status === "open");
  const resolvedTasks = tasks.filter((t) => t.status !== "open");

  // Field labels for the summary lines: UI presets, then tenant overrides.
  const fieldLabels: Record<string, string> = {
    need: ui.common.need,
    name: ui.common.name,
    phone: ui.common.phone,
    email: ui.common.email,
    guests: ui.reservation.guests,
    unit: ui.reservation.unit,
    ...instanceLabels,
  };

  const decisionLabels: RequestDecisionLabels = {
    approve: ui.meeting.approve,
    decline: ui.meeting.decline,
    reschedule: ui.meeting.reschedule,
    alternativeSlotLabel: ui.meeting.alternativeSlotLabel,
    alternativeSlotPlaceholder: ui.meeting.alternativeSlotPlaceholder,
    alternativeStartLabel: ui.reservation.alternativeCheckInLabel,
    alternativeEndLabel: ui.reservation.alternativeCheckOutLabel,
    noteLabel: ui.inbox.declineNoteLabel,
    notePlaceholder: ui.inbox.declineNotePlaceholder,
    customReplyLabel: ui.inbox.customReplyLabel,
    customReplyPlaceholder: ui.inbox.customReplyPlaceholder,
    currentStatus: ui.inbox.currentDecision,
    changeDecision: ui.inbox.changeDecision,
    cancel: ui.common.cancel,
  };

  const selectedRaw =
    tasks.find((t) => t.id === taskParam) ?? openTasks[0] ?? resolvedTasks[0];
  let selected = selectedRaw;
  if (selected?.lead.channel.provider === "instagram") {
    const changed = await enrichInstagramLeadIdentity({
      leadId: selected.leadId,
      tenantId,
    });
    if (changed) {
      const fresh = await prisma.hitlTask.findFirst({
        where: { id: selected.id, tenantId },
        include: TASK_INCLUDE,
      });
      if (fresh) selected = fresh;
    }
  }

  return (
    <div>
      <PageHeader title={ui.page.inboxTitle} />
      <div className="inbox-stats">
        <div className="stat-pill">
          {fillUi(ui.inbox.tasksWaiting, { count: openTasks.length })}
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="empty-state">
          <p>{ui.common.nothingWaiting}</p>
          <p className="muted">{ui.inbox.emptyHint}</p>
          <p>
            <Link href="/leads">{ui.page.leadsTitle}</Link>
          </p>
        </div>
      ) : (
        <div className="inbox-split">
          <div className="inbox-task-list">
            {openTasks.length > 0 ? (
              <>
                <p className="muted">{ui.inbox.waitingTitle}</p>
                {openTasks.map((task) => (
                  <InboxTaskLink
                    key={task.id}
                    task={task}
                    selectedId={selected?.id}
                    ui={ui}
                  />
                ))}
              </>
            ) : null}
            {resolvedTasks.length > 0 ? (
              <>
                <p
                  className="muted"
                  style={{ marginTop: openTasks.length ? "1rem" : undefined }}
                >
                  {ui.inbox.historyTitle}
                </p>
                {resolvedTasks.map((task) => (
                  <InboxTaskLink
                    key={task.id}
                    task={task}
                    selectedId={selected?.id}
                    ui={ui}
                  />
                ))}
              </>
            ) : null}
          </div>
          {selected ? (
            <InboxTaskDetail
              lang={lang}
              ui={ui}
              decisionLabels={decisionLabels}
              fieldLabels={fieldLabels}
              task={selected}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function InboxTaskLink({
  task,
  selectedId,
  ui,
}: {
  task: InboxTask;
  selectedId?: string;
  ui: Ui;
}) {
  const open = task.status === "open";
  return (
    <Link
      href={`/inbox?task=${task.id}`}
      className={`inbox-task-link${selectedId === task.id ? " active" : ""}`}
    >
      <strong>{leadDisplayName(task.lead)}</strong>
      <div className="muted">
        {requestTaskTitle(ui, taskRequest(task))}
        {" · "}
        {open ? ui.inbox.taskOpen : ui.inbox.taskResolved}
      </div>
    </Link>
  );
}

function InboxTaskDetail({
  lang,
  ui,
  decisionLabels,
  fieldLabels,
  task,
}: {
  lang: "he" | "en";
  ui: Ui;
  decisionLabels: RequestDecisionLabels;
  fieldLabels: Record<string, string>;
  task: InboxTask;
}) {
  const payload = task.payload as {
    requestId?: string;
    awaitingCustomerConfirm?: boolean;
    summary?: string;
  };
  const request = taskRequest(task);
  const taskTitle = requestTaskTitle(ui, request);
  const fields = (task.lead.fields ?? {}) as Record<string, string | undefined>;
  const isInstagram = task.lead.channel.provider === "instagram";
  const isWhatsapp = task.lead.channel.provider === "whatsapp";
  const igHandle = isInstagram ? leadInstagramUsername(task.lead.fields) : "";
  const phone =
    String(fields.phone ?? "").trim() || (isWhatsapp ? task.lead.externalUserId : "");
  const waUrl = isWhatsapp ? whatsappChatUrl(phone) : "";
  const latestConversationId = task.lead.conversations[0]?.id;
  const decisionsOnLatest =
    task.status === "open" ||
    !latestConversationId ||
    request?.conversationId === latestConversationId ||
    task.conversationId === latestConversationId;
  const resolution = task.resolution as {
    approved?: boolean;
    note?: string;
    awaitingCustomerConfirm?: boolean;
    customerConfirmed?: boolean;
    decision?: string;
  } | null;
  const awaitingCustomer =
    Boolean(payload.awaitingCustomerConfirm) ||
    Boolean(resolution?.awaitingCustomerConfirm);
  const pending = (!request || request.status === "pending") && !awaitingCustomer;
  const narrative =
    String(payload.summary ?? task.conversation?.summary ?? "").trim() ||
    ui.inbox.summaryEmpty;

  return (
    <div className="card inbox-task">
      <div className="inbox-task-header">
        <div className="inbox-task-title">
          <span className={`badge${task.status === "open" ? " badge-warn" : ""}`}>
            {taskTitle}
            {task.status !== "open" ? ` · ${ui.inbox.taskResolved}` : ""}
          </span>
          {awaitingCustomer ? (
            <span className="badge badge-warn">{ui.inbox.awaitingCustomer}</span>
          ) : null}
          {resolution?.customerConfirmed ? (
            <span className="badge">{ui.inbox.customerConfirmed}</span>
          ) : null}
          <span>{leadDisplayName(task.lead)}</span>
          {waUrl ? (
            <a href={waUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
              {formatPhoneDisplay(phone) || ui.common.whatsapp}
            </a>
          ) : null}
          {igHandle ? (
            <a
              href={instagramProfileUrl(igHandle)}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{igHandle}
            </a>
          ) : null}
          <ChannelBadge lang={lang} channel={task.lead.channel} />
        </div>
        <div className="row-actions">
          <Link
            href={`/leads/${task.leadId}?c=${task.conversationId}`}
            className="btn-ghost"
          >
            {ui.common.openLead}
          </Link>
          <Link href={`/demo?leadId=${task.leadId}`} className="btn-ghost">
            {ui.inbox.openChat}
          </Link>
        </div>
      </div>

      {!request && task.reason ? (
        <p>
          {ui.inbox.reason}: {hitlReasonLabel(ui, task.reason)}
        </p>
      ) : null}

      {request && !pending ? (
        <p className="muted">
          {ui.inbox.currentDecision}:{" "}
          <span className="badge">{statusLabel(ui, request)}</span>
          {resolution?.note ? ` · ${resolution.note}` : ""}
        </p>
      ) : null}

      <div className="inbox-preview">
        <p className="muted">{ui.inbox.summaryTitle}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{narrative}</p>
      </div>

      {request ? (
        <>
          {awaitingCustomer ? (
            <p className="muted">{ui.inbox.awaitingCustomerHint}</p>
          ) : null}
          {decisionsOnLatest ? (
            <RequestDecisionForm
              requestId={request.id}
              pending={pending}
              timeShape={requestTimeShape(request)}
              timeText={requestTimeDisplay(request)}
              headline={requestHeadline(request)}
              status={
                awaitingCustomer
                  ? ui.inbox.awaitingCustomer
                  : request.status === "approved" && resolution?.customerConfirmed
                    ? ui.inbox.customerConfirmed
                    : statusLabel(ui, request)
              }
              labels={decisionLabels}
              lines={requestSummaryLines({
                request,
                lang,
                labels: fieldLabels,
                // The CRM record wins when the lead updated their details later.
                overrides: {
                  name: fields.name,
                  phone: fields.phone,
                  email: fields.email,
                },
              })}
            />
          ) : (
            <p className="muted">{ui.inbox.decisionsLockedHint}</p>
          )}
        </>
      ) : task.status === "open" ? (
        <form action={`/api/hitl/${task.id}/complete`} method="post" className="stack">
          <div className="radio-card-grid compact">
            <label className="radio-card">
              <input type="radio" name="approved" value="yes" defaultChecked />
              <div className="radio-card-body">
                <strong>{ui.inbox.approveOption}</strong>
              </div>
            </label>
            <label className="radio-card">
              <input type="radio" name="approved" value="no" />
              <div className="radio-card-body">
                <strong>{ui.inbox.needInfoOption}</strong>
              </div>
            </label>
          </div>
          <textarea
            className="note-input"
            name="note"
            placeholder={ui.inbox.notePlaceholder}
            required
          />
          <div className="row-actions">
            <button type="submit">{ui.inbox.complete}</button>
          </div>
        </form>
      ) : (
        <p className="muted">{ui.inbox.taskResolved}</p>
      )}
    </div>
  );
}
