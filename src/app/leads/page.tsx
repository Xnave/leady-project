import Link from "next/link";
import { DeleteDemoLead } from "@/components/DeleteDemoLead";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { channelLabel, isDemoLead, leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { normalizeLeadStatus, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [leads, pendingMeetings] = await Promise.all([
    prisma.lead.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      include: {
        channel: true,
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
      <PageHeader
        title={ui.page.leadsTitle}
        actions={
          <>
            <Link href="/demo" className="btn-secondary">
              {ui.nav.chat}
            </Link>
            <Link href="/inbox" className="btn-secondary">
              {ui.nav.inbox}
            </Link>
          </>
        }
      />
      {pendingMeetings.length > 0 ? (
        <div className="card">
          <h2>{ui.common.visitsWaiting}</h2>
          <ul className="lead-list">
            {pendingMeetings.map((m) => (
              <li key={m.id}>
                <Link href={`/leads/${m.leadId}`}>{leadDisplayName(m.lead)}</Link>
                {" · "}
                <span className="badge">{ui.common.pending}</span>
                {" · "}
                {m.kind} · {m.slotText}
                {m.contactName ? ` · ${m.contactName}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{ui.common.name}</th>
              <th>{ui.common.channel}</th>
              <th>{ui.common.status}</th>
              <th>{ui.common.stage}</th>
              <th>{ui.common.visit}</th>
              <th>{ui.common.intent}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const fields = lead.fields as Record<string, unknown>;
              const stage = lead.conversations[0]?.flowState ?? ui.common.empty;
              const pending = lead.meetings.length;
              const demo = isDemoLead(lead.externalUserId);
              return (
                <tr key={lead.id}>
                  <td>
                    <Link href={`/leads/${lead.id}`}>{leadDisplayName(lead)}</Link>
                    {demo ? (
                      <>
                        {" "}
                        <span className="badge">{ui.common.demo}</span>
                      </>
                    ) : null}
                  </td>
                  <td>{channelLabel(lang, lead.channel)}</td>
                  <td>
                    <LeadStatusSelect
                      leadId={lead.id}
                      value={normalizeLeadStatus(lead.status)}
                      labels={ui.status}
                    />
                  </td>
                  <td>{stage}</td>
                  <td>
                    {pending > 0 ? (
                      <span className="badge">
                        {pending} {ui.common.pending}
                      </span>
                    ) : (
                      ui.common.empty
                    )}
                  </td>
                  <td>{String(fields.intent ?? ui.common.empty)}</td>
                  <td>
                    {demo ? (
                      <DeleteDemoLead
                        leadId={lead.id}
                        label={ui.common.delete}
                        confirmText={ui.common.confirmDeleteDemo}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {leads.length === 0 ? <p className="empty-state">{ui.common.noLeads}</p> : null}
    </div>
  );
}
