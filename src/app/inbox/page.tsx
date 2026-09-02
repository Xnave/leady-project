import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { fillUi, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
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

  return (
    <div>
      <PageHeader
        title={ui.page.inboxTitle}
        actions={
          <Link href="/demo" className="btn-secondary">
            {ui.inbox.openChat}
          </Link>
        }
      />
      <div className="inbox-stats">
        <div className="stat-pill">{fillUi(ui.inbox.tasksWaiting, { count: tasks.length })}</div>
      </div>
      {tasks.map((task) => {
        const payload = task.payload as {
          meetingId?: string;
          name?: string;
          phone?: string;
          email?: string;
          need?: string;
          slot?: string;
          kind?: string;
        };
        const isBooking = task.type === "booking_approval" && payload.meetingId;
        const taskTitle = isBooking ? ui.inbox.bookingApproval : ui.inbox.generalTask;
        return (
          <div key={task.id} className="card inbox-task">
            <div className="inbox-task-header">
              <div className="inbox-task-title">
                <span className="badge badge-warn">{taskTitle}</span>
                <span>{leadDisplayName(task.lead)}</span>
                <ChannelBadge lang={lang} channel={task.lead.channel} />
              </div>
              <div className="row-actions">
                <Link href={`/demo?leadId=${task.leadId}`} className="btn-secondary">
                  {ui.inbox.openChat}
                </Link>
                <Link href={`/leads/${task.leadId}`} className="btn-ghost">
                  {ui.common.openLead}
                </Link>
              </div>
            </div>
            {task.reason ? (
              <p className="muted">
                {ui.inbox.reason}: {task.reason}
              </p>
            ) : null}
            {isBooking ? (
              <MeetingDecisionForm
                meetingId={payload.meetingId!}
                pending
                labels={meetingLabels}
                summary={{
                  name:
                    String(
                      (task.lead.fields as { name?: string })?.name ??
                        payload.name ??
                        task.lead.displayName ??
                        "",
                    ) || undefined,
                  phone:
                    String(
                      (task.lead.fields as { phone?: string })?.phone ?? payload.phone ?? "",
                    ) || undefined,
                  email:
                    String(
                      (task.lead.fields as { email?: string })?.email ?? payload.email ?? "",
                    ) || undefined,
                  need:
                    String(
                      (task.lead.fields as { need?: string })?.need ??
                        payload.need ??
                        task.lead.meetings.find((m) => m.id === payload.meetingId)?.needText ??
                        "",
                    ) || undefined,
                  slot:
                    String(
                      payload.slot ??
                        task.lead.meetings.find((m) => m.id === payload.meetingId)?.slotText ??
                        "",
                    ) || undefined,
                  kind:
                    String(
                      payload.kind ??
                        task.lead.meetings.find((m) => m.id === payload.meetingId)?.kind ??
                        "",
                    ) || undefined,
                }}
              />
            ) : (
              <form action={`/api/hitl/${task.id}/complete`} method="post" className="stack">
                <fieldset>
                  <legend>{ui.inbox.decisionLegend}</legend>
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
                </fieldset>
                <textarea name="note" placeholder={ui.inbox.notePlaceholder} required />
                <button type="submit">{ui.inbox.complete}</button>
              </form>
            )}
          </div>
        );
      })}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <p>{ui.common.nothingWaiting}</p>
          <p className="muted">{ui.inbox.emptyHint}</p>
        </div>
      ) : null}
    </div>
  );
}
