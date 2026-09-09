import Link from "next/link";
import { ChannelBadge } from "@/components/ChannelBadge";
import { PageHeader } from "@/components/PageHeader";
import { FormSelect } from "@/components/Select";
import { Pagination } from "@/components/Pagination";
import { LeadStatusSelect } from "@/components/LeadStatusSelect";
import { MarkLeadRead } from "@/components/MarkLeadRead";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import {
  formatPhoneDisplay,
  instagramProfileUrl,
  leadDisplayName,
  leadInstagramUsername,
  whatsappChatUrl,
} from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { intentLabel, stageLabel } from "@/lib/ui/labels";
import { meetingKindLabel, normalizeLeadStatus, uiCopy } from "@/lib/ui";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [10, 20, 50] as const;
const STATUS_FILTERS = ["new", "open", "in_progress", "won", "lost"] as const;
const STAGE_FILTERS = [
  "talk",
  "escalate",
  "waiting_human",
  "done",
  "collect_lead",
  "classify_intent",
] as const;

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
    status?: string;
    stage?: string;
  }>;
}) {
  const { page: pageParam, size: sizeParam, q, status, stage } = await searchParams;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const pageSize = PAGE_SIZES.includes(Number(sizeParam) as (typeof PAGE_SIZES)[number])
    ? Number(sizeParam)
    : 20;
  const page = Math.max(1, Number(pageParam) || 1);
  const query = q?.trim() ?? "";
  const filterStatus = STATUS_FILTERS.includes(status as (typeof STATUS_FILTERS)[number])
    ? status!
    : "";
  const filterStage = STAGE_FILTERS.includes(stage as (typeof STAGE_FILTERS)[number])
    ? stage!
    : "";

  const where: Prisma.LeadWhereInput = {
    tenantId,
    NOT: { externalUserId: { startsWith: "demo-" } },
  };
  if (query) {
    where.OR = [
      { displayName: { contains: query, mode: "insensitive" } },
      { externalUserId: { contains: query, mode: "insensitive" } },
      { fields: { path: ["name"], string_contains: query, mode: "insensitive" } },
    ];
  }
  if (filterStatus) where.status = filterStatus;
  if (filterStage) {
    where.conversations = {
      some: { flowState: filterStage, messages: { some: {} } },
    };
  }

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
          where: { messages: { some: {} } },
          take: 1,
          orderBy: { updatedAt: "desc" },
          include: {
            messages: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
          },
        },
        meetings: { where: { status: "pending" } },
      },
    }),
    prisma.meeting.findMany({
      where: {
        tenantId,
        status: "pending",
        lead: { NOT: { externalUserId: { startsWith: "demo-" } } },
      },
      include: { lead: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const showVisit = leads.some((l) => l.meetings.length > 0) || pendingMeetings.length > 0;
  const extraParams: Record<string, string> = {
    ...(query ? { q: query } : {}),
    ...(filterStatus ? { status: filterStatus } : {}),
    ...(filterStage ? { stage: filterStage } : {}),
  };

  return (
    <div>
      <PageHeader title={ui.page.leadsTitle} />
      <form className="toolbar" method="get">
        <label>
          {ui.common.search}
          <input type="search" name="q" defaultValue={query} />
        </label>
        <label>
          {ui.common.status}
          <FormSelect
            name="status"
            defaultValue={filterStatus || "all"}
            ariaLabel={ui.common.status}
            options={[
              { value: "all", label: ui.common.all },
              ...STATUS_FILTERS.map((id) => ({
                value: id,
                label: ui.status[id as keyof typeof ui.status] ?? id,
              })),
            ]}
          />
        </label>
        <label>
          {ui.common.stage}
          <FormSelect
            name="stage"
            defaultValue={filterStage || "all"}
            ariaLabel={ui.common.stage}
            options={[
              { value: "all", label: ui.common.all },
              ...STAGE_FILTERS.map((id) => ({
                value: id,
                label: stageLabel(ui, id),
              })),
            ]}
          />
        </label>
        <button type="submit" className="btn-secondary">
          {ui.common.search}
        </button>
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
              const stageText = rawStage ? stageLabel(ui, rawStage) : ui.common.empty;
              const pending = lead.meetings.length;
              const intent = fields.intent ? intentLabel(ui, String(fields.intent)) : ui.common.empty;
              const igHandle =
                lead.channel.provider === "instagram" ? leadInstagramUsername(fields) : "";
              const phone =
                (typeof fields.phone === "string" && fields.phone) ||
                (lead.channel.provider === "whatsapp" ? lead.externalUserId : "");
              const phoneDisplay = formatPhoneDisplay(String(phone));
              const waUrl =
                lead.channel.provider === "whatsapp" ? whatsappChatUrl(String(phone)) : "";
              const igUrl = igHandle ? instagramProfileUrl(igHandle) : "";
              const channelHref = waUrl || igUrl || "";
              const channelExtra = waUrl
                ? phoneDisplay
                : igHandle
                  ? `@${igHandle}`
                  : "";
              const lastAt =
                lead.conversations[0]?.messages[0]?.createdAt ??
                lead.conversations[0]?.updatedAt ??
                lead.updatedAt;
              return (
                <tr key={lead.id} className={lead.adminUnread ? "row-unread" : undefined}>
                  <td>
                    <Link href={`/leads/${lead.id}`}>
                      {lead.adminUnread ? <strong>{leadDisplayName(lead)}</strong> : leadDisplayName(lead)}
                    </Link>
                  </td>
                  <td>
                    {channelHref ? (
                      <a
                        href={channelHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="channel-cell-link"
                      >
                        <ChannelBadge lang={lang} channel={lead.channel} />
                        {channelExtra ? (
                          <span className="muted" dir="ltr">
                            {" "}
                            {channelExtra}
                          </span>
                        ) : null}
                      </a>
                    ) : (
                      <ChannelBadge lang={lang} channel={lead.channel} />
                    )}
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
                  <td>{stageText}</td>
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
                    <MarkLeadRead
                      leadId={lead.id}
                      unread={lead.adminUnread}
                      markReadLabel={ui.inbox.markRead}
                      markUnreadLabel={ui.inbox.markUnread}
                    />
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
          extraParams={extraParams}
        />
      ) : null}
      {total === 0 ? <p className="empty-state">{ui.common.noLeads}</p> : null}
    </div>
  );
}
