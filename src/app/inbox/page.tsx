import Link from "next/link";
import { MeetingDecisionForm } from "@/components/MeetingDecisionForm";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const tenantId = await requireTenantId();
  const tasks = await prisma.hitlTask.findMany({
    where: { tenantId, status: "open" },
    include: { lead: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1>HITL inbox</h1>
      {tasks.map((task) => {
        const payload = task.payload as { meetingId?: string };
        const isBooking = task.type === "booking_approval" && payload.meetingId;
        return (
          <div key={task.id} className="card">
            <p>
              {task.type} · {task.lead.displayName ?? task.lead.externalUserId}
              {" · "}
              <Link href={`/leads/${task.leadId}`}>Open lead</Link>
            </p>
            <p className="muted">{task.reason}</p>
            {isBooking ? (
              <MeetingDecisionForm meetingId={payload.meetingId!} pending />
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
                <button type="submit">Complete and resume</button>
              </form>
            )}
          </div>
        );
      })}
      {tasks.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
    </div>
  );
}
