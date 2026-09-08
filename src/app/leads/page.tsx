import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { PageHeader } from "@/components/PageHeader";
import { FormSelect } from "@/components/Select";
import { Pagination } from "@/components/Pagination";
import { DeleteDemoLead } from "@/components/DeleteDemoLead";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import {
  avatarInitials,
  dayHeading,
  shortDate,
  groupByDay,
  messagePreview,
  rowState,
  rowTime,
} from "@/lib/conversation-list";
import {
  LEAD_RANGES,
  leadFilterParams,
  leadWhere,
  parseLeadFilters,
  rangeStart,
  type LeadRange,
} from "@/lib/lead-query";
import { isDemoLead, leadDisplayName, leadInstagramUsername } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { stageLabel } from "@/lib/ui/labels";
import { LEAD_STATUSES, fillUi, normalizeLeadStatus, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [10, 20, 50] as const;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    size?: string;
    q?: string;
    kind?: string;
    status?: string;
    range?: string;
  }>;
}) {
  const sp = await searchParams;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const now = new Date();
  const pageSize = PAGE_SIZES.includes(Number(sp.size) as (typeof PAGE_SIZES)[number])
    ? Number(sp.size)
    : 20;
  const page = Math.max(1, Number(sp.page) || 1);

  const filters = parseLeadFilters(sp);
  const where = leadWhere(tenantId, filters, now);
  const params = leadFilterParams(filters);
  const exportQuery = new URLSearchParams(params).toString();
  const approvedSince = rangeStart(filters.range, now);

  const [total, leads, needsYou, visitsPending, approved] = await Promise.all([
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
        meetings: { where: { status: "pending" }, select: { id: true } },
      },
    }),
    prisma.lead.count({
      where: {
        AND: [
          where,
          {
            OR: [
              { conversations: { some: { status: "waiting_human" } } },
              { meetings: { some: { status: "pending" } } },
            ],
          },
        ],
      },
    }),
    prisma.meeting.count({ where: { tenantId, status: "pending", lead: where } }),
    prisma.meeting.count({
      where: {
        tenantId,
        status: "approved",
        lead: where,
        ...(approvedSince ? { decidedAt: { gte: approvedSince } } : {}),
      },
    }),
  ]);

  const rangeLabels: Record<LeadRange, string> = {
    today: ui.conversations.rangeToday,
    "7d": ui.conversations.range7d,
    "30d": ui.conversations.range30d,
    all: ui.conversations.rangeAll,
  };

  const groups = groupByDay(leads, (lead) => lead.updatedAt);

  const pulse = [
    { key: "total", value: total, label: ui.conversations.pulseTotal },
    { key: "needsYou", value: needsYou, label: ui.conversations.pulseNeedsYou, warn: true },
    { key: "visits", value: visitsPending, label: ui.conversations.pulseVisits, warn: true },
    { key: "booked", value: approved, label: ui.conversations.pulseBooked },
  ];

  return (
    <div>
      <PageHeader title={ui.conversations.title} blurb={ui.conversations.blurb} />

      <div className="conv-toolbar">
        <nav className="range-tabs" aria-label={ui.common.lastActive}>
          {LEAD_RANGES.map((range) => {
            const href = new URLSearchParams({
              ...params,
              ...(range === "all" ? {} : { range }),
            });
            href.delete("range");
            if (range !== "all") href.set("range", range);
            const qs = href.toString();
            return (
              <Link
                key={range}
                href={qs ? `/leads?${qs}` : "/leads"}
                className={`range-tab${filters.range === range ? " active" : ""}`}
                aria-current={filters.range === range ? "true" : undefined}
              >
                {rangeLabels[range]}
              </Link>
            );
          })}
        </nav>

        <form className="conv-filters" method="get">
          {filters.range !== "all" ? (
            <input type="hidden" name="range" value={filters.range} />
          ) : null}
          <label className="conv-search">
            <span className="conv-field-label">{ui.common.search}</span>
            <input type="search" name="q" defaultValue={filters.q} />
          </label>
          <label>
            <span className="conv-field-label">{ui.common.status}</span>
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
          <label>
            <span className="conv-field-label">{ui.conversations.typeFilter}</span>
            <FormSelect
              name="kind"
              defaultValue={filters.kind}
              ariaLabel={ui.conversations.typeFilter}
              options={[
                { value: "all", label: ui.common.all },
                { value: "live", label: ui.common.live },
                { value: "demo", label: ui.common.demo },
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
      </div>

      <div className="pulse-row">
        {pulse.map((cell) => (
          <div
            key={cell.key}
            className={`pulse${cell.warn && cell.value > 0 ? " pulse-warn" : ""}`}
          >
            <span className="pulse-value">{cell.value}</span>
            <span className="pulse-label">{cell.label}</span>
          </div>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <p>{ui.conversations.emptyTitle}</p>
          <p className="muted">{ui.conversations.emptyBody}</p>
          <p>
            <Link href="/leads">{ui.conversations.emptyAction}</Link>
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="conv-day">
            <h2 className="conv-day-head">
              <span className="conv-day-name">{dayHeading(group.date, ui, lang, now)}</span>
              <span className="conv-day-count">
                {group.items.length === 1
                  ? ui.conversations.dayCountOne
                  : fillUi(ui.conversations.dayCount, { count: group.items.length })}
              </span>
            </h2>
            <div className="conv-list">
              {group.items.map((lead) => {
                const convo = lead.conversations[0];
                const fields = lead.fields as Record<string, unknown>;
                const name = leadDisplayName(lead);
                const demo = isDemoLead(lead.externalUserId);
                const handle = leadInstagramUsername(fields);
                const pending = lead.meetings.length;
                const state = rowState({
                  convoStatus: convo?.status,
                  pendingMeetings: pending,
                  leadStatus: lead.status,
                });
                const phone = typeof fields.phone === "string" ? fields.phone : "";
                return (
                  <article key={lead.id} className={`conv-row conv-${state}`}>
                    <span className="conv-avatar" aria-hidden="true">
                      {avatarInitials(name)}
                    </span>
                    <div className="conv-body">
                      <div className="conv-headline">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="conv-open"
                          aria-label={fillUi(ui.conversations.openConversation, { name })}
                        >
                          <span className="conv-name">{name}</span>
                        </Link>
                        {handle ? <span className="conv-handle">@{handle}</span> : null}
                        {demo ? <span className="badge badge-demo">{ui.common.demo}</span> : null}
                        <time className="conv-time" dateTime={lead.updatedAt.toISOString()}>
                          {rowTime(lead.updatedAt, lang, now)}
                        </time>
                      </div>
                      <p className="conv-preview">
                        {messagePreview(convo?.messages[0], ui)}
                      </p>
                      <div className="conv-meta">
                        {state === "needs_you" ? (
                          <span className="chip chip-warn">
                            {pending > 0
                              ? ui.conversations.visitPending
                              : ui.conversations.pausedForYou}
                          </span>
                        ) : null}
                        <ChannelBadge lang={lang} channel={lead.channel} />
                        {/* "talk" is where almost every live conversation sits,
                            so naming it on every row is noise. Only a stage the
                            owner would not assume earns a chip. */}
                        {convo?.flowState && convo.flowState !== "talk" ? (
                          <span className="chip">{stageLabel(ui, convo.flowState)}</span>
                        ) : null}
                        {phone ? <span className="conv-fact">{phone}</span> : null}
                        <span className="conv-fact conv-fact-quiet">
                          {fillUi(ui.conversations.openedOn, {
                            date: shortDate(lead.createdAt, lang, now),
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="conv-actions">
                      <LeadStatusSelect
                        leadId={lead.id}
                        value={normalizeLeadStatus(lead.status)}
                        labels={ui.status}
                        ariaLabel={ui.common.status}
                        failedLabel={ui.common.saveFailed}
                      />
                      {demo ? (
                        <DeleteDemoLead
                          leadId={lead.id}
                          label={ui.common.delete}
                          confirmText={ui.common.confirmDeleteDemo}
                        />
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}

      {total > pageSize ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          basePath="/leads"
          ui={ui}
          extraParams={params}
        />
      ) : null}
    </div>
  );
}
