import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SetupJourney } from "@/components/SetupJourney";
import { prisma } from "@/lib/db";
import { getNavCounts } from "@/lib/nav-counts";
import { getOwnerMetrics } from "@/lib/metrics";
import { getUiLang } from "@/lib/cookies";
import { leadDisplayName } from "@/lib/leads";
import { requireTenantId } from "@/lib/tenant";
import { meetingKindLabel, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [tenant, counts, metrics, liveChannel, pendingMeetings, pausedConversations] =
    await Promise.all([
      prisma.tenant.findFirst({ where: { id: tenantId } }),
      getNavCounts(tenantId),
      getOwnerMetrics(tenantId),
      prisma.channelConnection.findFirst({
        where: {
          tenantId,
          provider: "whatsapp",
          NOT: { providerAccountId: { startsWith: "demo-" } },
        },
      }),
      prisma.meeting.findMany({
        where: { tenantId, status: "pending" },
        include: { lead: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.conversation.findMany({
        where: { tenantId, status: "waiting_human" },
        include: { lead: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ]);
  const needsSetup = !(tenant?.intro ?? "").trim();
  const hasChannel = Boolean(liveChannel);
  const setupIncomplete = needsSetup || !hasChannel;

  const journey = [
    { href: "/onboard", label: ui.home.stepSetup, done: !needsSetup },
    { href: "/channels", label: ui.home.stepChannels, done: hasChannel },
    { href: "/demo", label: ui.home.stepChat, done: !needsSetup },
    { href: "/leads", label: ui.home.stepLeads, done: counts.leads > 0, count: counts.leads },
    { href: "/inbox", label: ui.home.stepInbox, done: counts.inbox === 0, count: counts.inbox },
  ];

  const cta =
    counts.inbox > 0
      ? { href: "/inbox", label: ui.home.ctaInbox }
      : !hasChannel
        ? { href: "/channels", label: ui.home.ctaConnect }
        : needsSetup
          ? { href: "/onboard", label: ui.nav.setup }
          : { href: "/leads", label: ui.home.quickLeads };

  // "Needs you now" is the only list on the dashboard that implies an action,
  // so it is built from the three states that actually stall a conversation.
  const attention = [
    ...(metrics.openTasks > 0
      ? [
          {
            key: "tasks",
            href: "/inbox",
            label: ui.metrics.openTasks,
            detail: String(metrics.openTasks),
          },
        ]
      : []),
    ...pendingMeetings.map((m) => ({
      key: `meeting-${m.id}`,
      href: `/leads/${m.leadId}`,
      label: leadDisplayName(m.lead),
      detail: `${meetingKindLabel(ui, m.kind)} · ${m.slotText}`,
    })),
    ...pausedConversations.map((c) => ({
      key: `paused-${c.id}`,
      href: `/leads/${c.leadId}`,
      label: leadDisplayName(c.lead),
      detail: ui.metrics.waitingHuman,
    })),
  ].slice(0, 8);

  const metricCards: { key: string; value: string; label: string; attention?: boolean }[] = [
    { key: "leadsToday", value: String(metrics.leadsToday), label: ui.metrics.leadsToday },
    { key: "leads7d", value: String(metrics.leads7d), label: ui.metrics.leads7d },
    {
      key: "active",
      value: String(metrics.activeConversations),
      label: ui.metrics.activeConversations,
    },
    {
      key: "waiting",
      value: String(metrics.waitingHuman),
      label: ui.metrics.waitingHuman,
      attention: metrics.waitingHuman > 0,
    },
    {
      key: "meetingsPending",
      value: String(metrics.meetingsPending),
      label: ui.metrics.meetingsPending,
      attention: metrics.meetingsPending > 0,
    },
    {
      key: "meetingsApproved",
      value: String(metrics.meetingsApproved7d),
      label: ui.metrics.meetingsApproved7d,
    },
    {
      key: "messages",
      value: `${metrics.messagesIn7d} / ${metrics.messagesOut7d}`,
      label: ui.metrics.messages7d,
    },
    {
      key: "auto",
      value: metrics.autoHandledPct === null ? "—" : `${metrics.autoHandledPct}%`,
      label: ui.metrics.autoHandled,
    },
  ];

  return (
    <div className="stack">
      <PageHeader title={ui.page.homeTitle} blurb={needsSetup ? ui.page.homeSetup : ui.page.homeBlurb} />
      <div className="work-strip">
        <Link href="/leads" className="card stat-card">
          <span className="stat-value">{counts.leads}</span>
          <span className="stat-label">{ui.home.quickLeads}</span>
        </Link>
        <Link href="/inbox" className="card stat-card">
          <span className="stat-value">{counts.inbox}</span>
          <span className="stat-label">{ui.home.quickInbox}</span>
        </Link>
        <Link href="/channels" className="card stat-card">
          <span className="stat-value">{hasChannel ? "●" : "○"}</span>
          <span className="stat-label">{hasChannel ? ui.home.whatsappOk : ui.home.whatsappOff}</span>
        </Link>
        <Link href={cta.href} className="btn">
          {cta.label}
        </Link>
      </div>
      {setupIncomplete ? <SetupJourney ui={ui} steps={journey} /> : null}
      <div className="card">
        <h2>{ui.metrics.needsYou}</h2>
        {attention.length === 0 ? (
          <p className="muted">{ui.metrics.allClear}</p>
        ) : (
          <ul className="attention-list">
            {attention.map((item) => (
              <li key={item.key}>
                <Link href={item.href}>{item.label}</Link>
                <span className="muted">{item.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h2>{ui.metrics.legend}</h2>
        <div className="metric-grid">
          {metricCards.map((card) => (
            <div key={card.key} className={`metric${card.attention ? " attention" : ""}`}>
              <span className="metric-value">{card.value}</span>
              <span className="metric-label">{card.label}</span>
            </div>
          ))}
        </div>
        <p className="muted">
          {metrics.autoHandledPct === null ? ui.metrics.noData : ui.metrics.autoHandledHint}
        </p>
      </div>
    </div>
  );
}
