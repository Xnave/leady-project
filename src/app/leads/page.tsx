import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { PageHeader } from "@/components/PageHeader";
import { FormSelect } from "@/components/Select";
import { Pagination } from "@/components/Pagination";
import { DeleteDemoLead } from "@/components/DeleteDemoLead";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { instagramProfileUrl, isDemoLead, leadDisplayName, leadInstagramUsername } from "@/lib/leads";
import { leadFilterParams, leadWhere, parseLeadFilters } from "@/lib/lead-query";
import { requireTenantId } from "@/lib/tenant";
import { intentLabel, stageLabel } from "@/lib/ui/labels";
import { LEAD_STATUSES, meetingKindLabel, normalizeLeadStatus, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [10, 20, 50] as const;

function formatWhen(d: Date, lang: string) {
  return d.toLocaleString(lang === "he" ? "he-IL" : "en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    size?: string;
    q?: string;
    kind?: string;
    status?: string;
  }>;
}) {
  const sp = await searchParams;
  const { page: pageParam, size: sizeParam } = sp;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const pageSize = PAGE_SIZES.includes(Number(sizeParam) as (typeof PAGE_SIZES)[number])
    ? Number(sizeParam)
    : 20;
  const page = Math.max(1, Number(pageParam) || 1);
  const filters = parseLeadFilters(sp);
  const query = filters.q;
  const filterKind = filters.kind;
  const where = leadWhere(tenantId, filters);
  const exportQuery = new URLSearchParams(leadFilterParams(filters)).toString();

  const [total, leads, pendingMeetings] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        channel: true,
        conversations: {
          take: 1,
          orderBy: { updatedAt: "desc" },
          include: { messages: { take: 1, orderBy: { createdAt: "desc" } } },
        },
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

  const showVisit = leads.some((l) => l.meetings.length > 0) || pendingMeetings.length > 0;

  return (
    <div>
      <PageHeader title={`${ui.page.leadsTitle} (${total})`} />
      <form className="toolbar" method="get">
        <label>
          {ui.common.search}
          <input type="search" name="q" defaultValue={query} />
        </label>
        <label>
          {ui.common.demo}
          <FormSelect
            name="kind"
            defaultValue={filterKind}
            ariaLabel={ui.common.demo}
            options={[
              { value: "all", label: ui.common.all },
              { value: "live", label: ui.common.live },
              { value: "demo", label: ui.common.demo },
            ]}
          />
        </label>
        <label>
          {ui.common.status}
          <FormSelect
            name="status"
            defaultValue={filters.status}
            ariaLabel={ui.common.status}
            options={[
              { value: "all", label: ui.common.anyStatus },
              ...LEAD_STATUSES.map((id) => ({ value: id, label: ui.status[id] })),
            ]}
          />
        </label>
        <button type="submit" className="btn-secondary">
          {ui.common.search}
        </button>
        <a
          className="btn-secondary"
          href={`/api/leads/export${exportQuery ? `?${exportQuery}` : ""}`}
        >
          {ui.common.exportCsv}
        </a>
      </form>
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
                {meetingKindLabel(ui, m.kind)} · {m.slotText}
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
              {showVisit ? <th>{ui.common.visit}</th> : null}
              <th>{ui.common.intent}</th>
              <th>{ui.common.lastActive}</th>
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
              const igHandle = leadInstagramUsername(fields);
              const lastAt = lead.conversations[0]?.updatedAt ?? lead.updatedAt;
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
                    {igHandle ? (
                      <div className="muted">
                        <a
                          href={instagramProfileUrl(igHandle)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          @{igHandle}
                        </a>
                      </div>
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
                      failedLabel={ui.common.saveFailed}
                    />
                  </td>
                  <td>{stage}</td>
                  {showVisit ? (
                    <td>
                      {pending > 0 ? (
                        <span className="badge badge-warn">
                          {pending} {ui.common.pending}
                        </span>
                      ) : (
                        ui.common.empty
                      )}
                    </td>
                  ) : null}
                  <td>{intent}</td>
                  <td className="muted">{formatWhen(lastAt, lang)}</td>
                  <td className="table-actions">
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
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          basePath="/leads"
          ui={ui}
          extraParams={leadFilterParams(filters)}
        />
      ) : null}
      {total === 0 ? <p className="empty-state">{ui.common.noLeads}</p> : null}
    </div>
  );
}
