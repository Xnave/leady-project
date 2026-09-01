import Link from "next/link";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { channelLabel, leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

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

  return (
    <div>
      <PageHeader title={ui.page.inboxTitle} />
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
        return (
          <div key={task.id} className="card">
            <p>
              {task.type} · {leadDisplayName(task.lead)}
              {" · "}
              <span className="muted">{channelLabel(lang, task.lead.channel)}</span>
              {" · "}
              <Link href={`/leads/${task.leadId}`}>{ui.common.openLead}</Link>
            </p>
            <p className="muted">{task.reason}</p>
            {isBooking ? (
              <MeetingDecisionForm
                meetingId={payload.meetingId!}
                pending
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
                  <legend>Decision</legend>
                  <label className="choice">
                    <input type="radio" name="approved" value="yes" defaultChecked />
                    Approve
                  </label>
                  <label className="choice">
                    <input type="radio" name="approved" value="no" />
                    Need more info
                  </label>
                </fieldset>
                <textarea name="note" placeholder="Note the agent should use" required />
                <button type="submit">{ui.common.save}</button>
              </form>
            )}
          </div>
        );
      })}
      {tasks.length === 0 ? <p className="empty-state">{ui.common.nothingWaiting}</p> : null}
    </div>
  );
}
