import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";
import { DeleteDemoLead } from "@/components/DeleteDemoLead";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { isDemoLead, leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { intentLabel, stageLabel } from "@/lib/ui/labels";
import { normalizeLeadStatus, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [10, 20, 50] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  const { page: pageParam, size: sizeParam } = await searchParams;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const pageSize = PAGE_SIZES.includes(Number(sizeParam) as (typeof PAGE_SIZES)[number])
    ? Number(sizeParam)
    : 20;
  const page = Math.max(1, Number(pageParam) || 1);

  const [total, leads, pendingMeetings] = await Promise.all([
    prisma.lead.count({ where: { tenantId } }),
    prisma.lead.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
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
      take: 5,
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
              const rawStage = lead.conversations[0]?.flowState;
              const stage = rawStage ? stageLabel(ui, rawStage) : ui.common.empty;
              const pending = lead.meetings.length;
              const demo = isDemoLead(lead.externalUserId);
              const intent = fields.intent ? intentLabel(ui, String(fields.intent)) : ui.common.empty;
              return (
                <tr key={lead.id}>
                  <td>
                    <Link href={`/leads/${lead.id}`}>{leadDisplayName(lead)}</Link>
                    {demo ? (
                      <>
                        {" "}
                        <span className="badge badge-demo">{ui.common.demo}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <ChannelBadge lang={lang} channel={lead.channel} />
                  </td>
                  <td>
                    <LeadStatusSelect
                      leadId={lead.id}
                      value={normalizeLeadStatus(lead.status)}
                      labels={ui.status}
                      ariaLabel={ui.common.status}
                    />
                  </td>
                  <td>{stage}</td>
                  <td>
                    {pending > 0 ? (
                      <span className="badge badge-warn">
                        {pending} {ui.common.pending}
                      </span>
                    ) : (
                      ui.common.empty
                    )}
                  </td>
                  <td>{intent}</td>
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
      {total > 0 ? (
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/leads" ui={ui} />
      ) : null}
      {total === 0 ? <p className="empty-state">{ui.common.noLeads}</p> : null}
    </div>
  );
}
