import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { enrichInstagramLeadIdentity } from "@/lib/conversations";
import { instagramProfileUrl, leadDisplayName, leadInstagramUsername } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { fillUi, hitlReasonLabel, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const { task: taskParam } = await searchParams;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tasks = await prisma.hitlTask.findMany({
    where: { tenantId, status: "open" },
    include: {
      lead: {
        include: {
          channel: true,
          meetings: { orderBy: { createdAt: "desc" }, take: 3 },
          conversations: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            include: { messages: { orderBy: { createdAt: "desc" }, take: 8 } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const meetingLabels = {
    need: ui.common.need,
    name: ui.common.name,
    phone: ui.common.phone,
    email: ui.common.email,
    approve: ui.meeting.approve,
    decline: ui.meeting.decline,
    visitDefault: ui.meeting.visitDefault,
  };

  const selectedRaw = tasks.find((t) => t.id === taskParam) ?? tasks[0];
  let selected = selectedRaw;
  if (selected?.lead.channel.provider === "instagram") {
    const changed = await enrichInstagramLeadIdentity({
      leadId: selected.leadId,
      tenantId,
    });
    if (changed) {
      const freshLead = await prisma.lead.findFirst({
        where: { id: selected.leadId, tenantId },
        include: {
          channel: true,
          meetings: { orderBy: { createdAt: "desc" }, take: 3 },
          conversations: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            include: { messages: { orderBy: { createdAt: "desc" }, take: 8 } },
          },
        },
      });
      if (freshLead) selected = { ...selected, lead: freshLead };
    }
  }

  return (
    <div>
      <PageHeader title={ui.page.inboxTitle} />
      <div className="inbox-stats">
        <div className="stat-pill">{fillUi(ui.inbox.tasksWaiting, { count: tasks.length })}</div>
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
            {tasks.map((task) => {
              const isBooking = task.type === "booking_approval";
              return (
                <Link
                  key={task.id}
                  href={`/inbox?task=${task.id}`}
                  className={`inbox-task-link${selected?.id === task.id ? " active" : ""}`}
                >
                  <strong>{leadDisplayName(task.lead)}</strong>
                  <div className="muted">
                    {isBooking ? ui.inbox.bookingApproval : ui.inbox.generalTask}
                  </div>
                </Link>
              );
            })}
          </div>
          {selected ? (
            <InboxTaskDetail lang={lang} ui={ui} meetingLabels={meetingLabels} task={selected} />
          ) : null}
        </div>
      )}
    </div>
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
    visitDefault: string;
  };
  task: {
    id: string;
    type: string;
    reason: string | null;
    leadId: string;
    payload: unknown;
    lead: {
      displayName: string | null;
      externalUserId: string;
      fields: unknown;
      channel: { provider: string; providerAccountId: string };
      meetings: Array<{
        id: string;
        needText: string | null;
        slotText: string;
        kind: string;
        contactName: string | null;
        contactPhone: string | null;
      }>;
      conversations: Array<{
        messages: Array<{ id: string; role: string; text: string }>;
      }>;
    };
  };
}) {
  const payload = task.payload as {
    meetingId?: string;
    name?: string;
    phone?: string;
    email?: string;
    need?: string;
    slot?: string;
    date?: string;
    time?: string;
    kind?: string;
    details?: string;
  };
  const isBooking = task.type === "booking_approval" && payload.meetingId;
  const taskTitle = isBooking ? ui.inbox.bookingApproval : ui.inbox.generalTask;
  const fields = (task.lead.fields ?? {}) as Record<string, string | undefined>;
  const igHandle = leadInstagramUsername(task.lead.fields);
  const meeting = task.lead.meetings.find((m) => m.id === payload.meetingId);

  const summary = {
    name:
      String(fields.name ?? payload.name ?? meeting?.contactName ?? task.lead.displayName ?? "") ||
      undefined,
    phone: String(fields.phone ?? payload.phone ?? meeting?.contactPhone ?? "") || undefined,
    email: String(fields.email ?? payload.email ?? "") || undefined,
    need: String(fields.need ?? payload.need ?? meeting?.needText ?? "") || undefined,
    slot:
      String(payload.slot ?? meeting?.slotText ?? fields.time_preference ?? "") || undefined,
    kind: String(payload.kind ?? meeting?.kind ?? "") || undefined,
    details: String(payload.details ?? "") || undefined,
    intent: String(fields.intent ?? "") || undefined,
  };

  const detailRows = [
    { label: ui.inbox.summaryWhen, value: summary.slot },
    { label: meetingLabels.name, value: summary.name },
    { label: meetingLabels.phone, value: summary.phone },
    { label: meetingLabels.email, value: summary.email },
    { label: meetingLabels.need, value: summary.need || summary.details },
    { label: ui.inbox.summaryIntent, value: summary.intent },
  ].filter((row) => String(row.value ?? "").trim());

  return (
    <div className="card inbox-task">
      <div className="inbox-task-header">
        <div className="inbox-task-title">
          <span className="badge badge-warn">{taskTitle}</span>
          <span>{leadDisplayName(task.lead)}</span>
          {igHandle ? (
            <a href={instagramProfileUrl(igHandle)} target="_blank" rel="noopener noreferrer">
              @{igHandle}
            </a>
          ) : null}
          <ChannelBadge lang={lang} channel={task.lead.channel} />
        </div>
        <div className="row-actions">
          <Link href={`/demo?leadId=${task.leadId}`} className="btn-ghost">
            {ui.inbox.openChat}
          </Link>
          <Link href={`/leads/${task.leadId}`} className="btn-ghost">
            {ui.common.openLead}
          </Link>
        </div>
      </div>
      {task.reason ? (
        <p>
          {ui.inbox.reason}: {hitlReasonLabel(ui, task.reason)}
        </p>
      ) : null}
      <div className="inbox-preview">
        <p className="muted">{ui.inbox.summaryTitle}</p>
        {detailRows.length === 0 ? (
          <p className="muted">{ui.inbox.summaryEmpty}</p>
        ) : (
          <div className="stage-node">
            {detailRows.map((row) => (
              <p key={row.label}>
                <strong>{row.label}:</strong> {row.value}
              </p>
            ))}
          </div>
        )}
      </div>
      {isBooking ? (
        <MeetingDecisionForm
          meetingId={payload.meetingId!}
          pending
          labels={meetingLabels}
          summary={{
            name: summary.name,
            phone: summary.phone,
            email: summary.email,
            need: summary.need || summary.details,
            slot: summary.slot,
            kind: summary.kind,
          }}
        />
      ) : (
        <form action={`/api/hitl/${task.id}/complete`} method="post" className="stack">
          <div className="radio-card-grid compact">
            <label className="radio-card selected">
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
      )}
    </div>
  );
}
