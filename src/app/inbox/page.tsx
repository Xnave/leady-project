import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { enrichInstagramLeadIdentity } from "@/lib/conversations";
import { formatPhoneDisplay, instagramProfileUrl, leadDisplayName, leadInstagramUsername, whatsappChatUrl } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { fillUi, hitlReasonLabel, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

type InboxTask = Awaited<ReturnType<typeof loadInboxTasks>>[number];

async function loadInboxTasks(tenantId: string) {
  return prisma.hitlTask.findMany({
    where: {
      tenantId,
      OR: [{ status: "open" }, { type: "booking_approval" }],
    },
    include: {
      lead: {
        include: {
          channel: true,
          meetings: { orderBy: { createdAt: "desc" }, take: 10 },
          conversations: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      conversation: true,
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const { task: taskParam } = await searchParams;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tasks = await loadInboxTasks(tenantId);
  const openTasks = tasks.filter((t) => t.status === "open");
  const resolvedTasks = tasks.filter((t) => t.status !== "open");

  const meetingLabels = {
    need: ui.common.need,
    name: ui.common.name,
    phone: ui.common.phone,
    email: ui.common.email,
    approve: ui.meeting.approve,
    decline: ui.meeting.decline,
    reschedule: ui.meeting.reschedule,
    alternativeSlotLabel: ui.meeting.alternativeSlotLabel,
    alternativeSlotPlaceholder: ui.meeting.alternativeSlotPlaceholder,
    visitDefault: ui.meeting.visitDefault,
    noteLabel: ui.inbox.declineNoteLabel,
    notePlaceholder: ui.inbox.declineNotePlaceholder,
    customReplyLabel: ui.inbox.customReplyLabel,
    customReplyPlaceholder: ui.inbox.customReplyPlaceholder,
    updateDecision: ui.inbox.updateDecision,
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
        include: {
          lead: {
            include: {
              channel: true,
              meetings: { orderBy: { createdAt: "desc" }, take: 10 },
              conversations: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
          conversation: true,
        },
      });
      if (fresh) selected = fresh;
    }
  }

  return (
    <div>
      <PageHeader title={ui.page.inboxTitle} />
      <div className="inbox-stats">
        <div className="stat-pill">{fillUi(ui.inbox.tasksWaiting, { count: openTasks.length })}</div>
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
                  <InboxTaskLink key={task.id} task={task} selectedId={selected?.id} ui={ui} />
                ))}
              </>
            ) : null}
            {resolvedTasks.length > 0 ? (
              <>
                <p className="muted" style={{ marginTop: openTasks.length ? "1rem" : undefined }}>
                  {ui.inbox.historyTitle}
                </p>
                {resolvedTasks.map((task) => (
                  <InboxTaskLink key={task.id} task={task} selectedId={selected?.id} ui={ui} />
                ))}
              </>
            ) : null}
          </div>
          {selected ? (
            <InboxTaskDetail lang={lang} ui={ui} meetingLabels={meetingLabels} task={selected} />
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
  ui: ReturnType<typeof uiCopy>;
}) {
  const isBooking = task.type === "booking_approval";
  const open = task.status === "open";
  return (
    <Link
      href={`/inbox?task=${task.id}`}
      className={`inbox-task-link${selectedId === task.id ? " active" : ""}`}
    >
      <strong>{leadDisplayName(task.lead)}</strong>
      <div className="muted">
        {isBooking ? ui.inbox.bookingApproval : ui.inbox.generalTask}
        {" · "}
        {open ? ui.inbox.taskOpen : ui.inbox.taskResolved}
      </div>
    </Link>
  );
}

function InboxTaskDetail({
  lang,
  ui,
  meetingLabels,
  task,
}: {
  lang: "he" | "en";
  ui: ReturnType<typeof uiCopy>;
  meetingLabels: {
    need: string;
    name: string;
    phone: string;
    email: string;
    approve: string;
    decline: string;
    reschedule: string;
    alternativeSlotLabel: string;
    alternativeSlotPlaceholder: string;
    visitDefault: string;
    noteLabel: string;
    notePlaceholder: string;
    customReplyLabel: string;
    customReplyPlaceholder: string;
    updateDecision: string;
    currentStatus: string;
    changeDecision: string;
    cancel: string;
  };
  task: InboxTask;
}) {
  const payload = task.payload as {
    meetingId?: string;
    name?: string;
    phone?: string;
    email?: string;
    need?: string;
    slot?: string;
    kind?: string;
    summary?: string;
  };
  const isBooking = task.type === "booking_approval" && payload.meetingId;
  const taskTitle = isBooking ? ui.inbox.bookingApproval : ui.inbox.generalTask;
  const fields = (task.lead.fields ?? {}) as Record<string, string | undefined>;
  const isInstagram = task.lead.channel.provider === "instagram";
  const isWhatsapp = task.lead.channel.provider === "whatsapp";
  const igHandle = isInstagram ? leadInstagramUsername(task.lead.fields) : "";
  const phone =
    String(fields.phone ?? "").trim() ||
    (isWhatsapp ? task.lead.externalUserId : "");
  const waUrl = isWhatsapp ? whatsappChatUrl(phone) : "";
  const meeting = task.lead.meetings.find((m) => m.id === payload.meetingId);
  const latestConversationId = task.lead.conversations[0]?.id;
  const decisionsOnLatest =
    !latestConversationId ||
    meeting?.conversationId === latestConversationId ||
    task.conversationId === latestConversationId;
  const payloadFlags = payload as {
    meetingId?: string;
    awaitingCustomerConfirm?: boolean;
  };
  const resolution = task.resolution as {
    approved?: boolean;
    note?: string;
    awaitingCustomerConfirm?: boolean;
    customerConfirmed?: boolean;
    decision?: string;
  } | null;
  const awaitingCustomer =
    Boolean(payloadFlags.awaitingCustomerConfirm) ||
    Boolean(resolution?.awaitingCustomerConfirm);
  const meetingPending =
    (!meeting || meeting.status === "pending") && !awaitingCustomer;
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
            <a href={instagramProfileUrl(igHandle)} target="_blank" rel="noopener noreferrer">
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
      {!isBooking && task.reason ? (
        <p>
          {ui.inbox.reason}: {hitlReasonLabel(ui, task.reason)}
        </p>
      ) : null}
      {!meetingPending && meeting ? (
        <p className="muted">
          {ui.inbox.currentDecision}:{" "}
          <span className="badge">
            {meeting.status === "pending"
              ? ui.common.pending
              : meeting.status === "approved"
                ? ui.meeting.approved
                : meeting.status === "rejected"
                  ? ui.meeting.rejected
                  : meeting.status}
          </span>
          {resolution?.note ? ` · ${resolution.note}` : ""}
        </p>
      ) : null}
      <div className="inbox-preview">
        <p className="muted">{ui.inbox.summaryTitle}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{narrative}</p>
      </div>
      {isBooking && meeting ? (
        <>
          {awaitingCustomer ? (
            <p className="muted">{ui.inbox.awaitingCustomerHint}</p>
          ) : null}
          {decisionsOnLatest ? (
            <MeetingDecisionForm
              meetingId={payload.meetingId!}
              pending={meetingPending}
              status={
                awaitingCustomer
                  ? ui.inbox.awaitingCustomer
                  : meeting.status === "pending"
                    ? ui.common.pending
                    : meeting.status === "approved"
                      ? resolution?.customerConfirmed
                        ? ui.inbox.customerConfirmed
                        : ui.meeting.approved
                      : meeting.status === "rejected"
                        ? ui.meeting.rejected
                        : meeting.status
              }
              labels={meetingLabels}
              summary={{
                name:
                  String(fields.name ?? payload.name ?? meeting.contactName ?? "") ||
                  undefined,
                phone:
                  String(fields.phone ?? payload.phone ?? meeting.contactPhone ?? "") ||
                  undefined,
                email: String(fields.email ?? payload.email ?? "") || undefined,
                need:
                  String(fields.need ?? payload.need ?? meeting.needText ?? "") || undefined,
                slot: String(payload.slot ?? meeting.slotText ?? "") || undefined,
                kind: String(payload.kind ?? meeting.kind ?? "") || undefined,
              }}
            />
          ) : (
            <p className="muted">{ui.inbox.decisionsLockedHint}</p>
          )}
        </>
      ) : !isBooking && task.status === "open" ? (
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
      ) : !isBooking ? (
        <p className="muted">{ui.inbox.taskResolved}</p>
      ) : null}
    </div>
  );
}
