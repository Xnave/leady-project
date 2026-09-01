import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const tenantId = await requireTenantId();
  const [leads, pendingMeetings] = await Promise.all([
    prisma.lead.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      include: {
        conversations: { take: 1, orderBy: { updatedAt: "desc" } },
        meetings: { where: { status: "pending" } },
      },
    }),
    prisma.meeting.findMany({
      where: { tenantId, status: "pending" },
      include: { lead: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div>
      <h1>Leads</h1>
      <p>
        <Link href="/demo">Chat preview</Link>
        {" · "}
        <Link href="/inbox">HITL inbox</Link>
      </p>
      {pendingMeetings.length > 0 ? (
        <div className="card">
          <h2>Visits waiting for approval</h2>
          <ul className="lead-list">
            {pendingMeetings.map((m) => (
              <li key={m.id}>
                <Link href={`/leads/${m.leadId}`}>
                  {m.lead.displayName ?? m.lead.externalUserId}
                </Link>
                {" · "}
                <span className="badge">pending</span>
                {" · "}
                {m.kind} · {m.slotText}
                {m.contactName ? ` · ${m.contactName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>Contact</th>
            <th>Status</th>
            <th>Stage</th>
            <th>Visit</th>
            <th>Intent</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const fields = lead.fields as Record<string, unknown>;
            const stage = lead.conversations[0]?.flowState ?? "—";
            const pending = lead.meetings.length;
            return (
              <tr key={lead.id}>
                <td>
                  <Link href={`/leads/${lead.id}`}>
                    {lead.displayName ?? lead.externalUserId}
                  </Link>
                </td>
                <td>{lead.status}</td>
                <td>{stage}</td>
                <td>
                  {pending > 0 ? (
                    <span className="badge">{pending} pending</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{String(fields.intent ?? "—")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {leads.length === 0 ? <p className="muted">No leads yet. Try Chat preview.</p> : null}
    </div>
  );
}
