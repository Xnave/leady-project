import Link from "next/link";
import type { CSSProperties } from "react";
import { SetupJourney } from "@/components/SetupJourney";
import { initials, relTime } from "@/components/crm/format";
import { Icon, type IconName } from "@/components/crm/Icon";
import { avatarDotClass } from "@/components/crm/rows";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { localDateAndHour } from "@/lib/crm/digest";
import { loadHomeData, type HomeData } from "@/lib/crm/home";
import { NEEDS_REASONS, RANKED_STAGES, type FollowUpReason, type PipelineStage } from "@/lib/crm/types";
import { loadWonLabel } from "@/lib/crm/won-label";
import { requireTenantIdForPage } from "@/lib/tenant";
import { canManageTenant } from "@/lib/tenant-role";
import { fillUi, uiCopy, type UiCopy, type UiLang } from "@/lib/ui";

export const dynamic = "force-dynamic";

/** Same icons as the leads list (`LeadRow`), which is a client module. */
const FU_ICON: Record<FollowUpReason, IconName> = { handoff: "hand", approval: "clock", reminder: "bell", cold: "cold" };

const STAGE_TONE: Record<(typeof RANKED_STAGES)[number], string> = {
  new: "new",
  talking: "talking",
  qualified: "qualified",
  link_sent: "link",
  pending: "pending",
  won: "won",
};

function locale(lang: UiLang): string {
  return lang === "he" ? "he-IL" : "en-GB";
}

function greeting(ui: UiCopy, hour: number): string {
  if (hour >= 5 && hour < 12) return ui.home.greetMorning;
  if (hour >= 12 && hour < 17) return ui.home.greetAfternoon;
  return ui.home.greetEvening;
}

export default async function HomePage() {
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const now = new Date();
  const [tenant, liveChannel, manager, data, wonLabel] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true, intro: true, timezone: true } }),
    prisma.channelConnection.findFirst({
      where: {
        tenantId,
        provider: "whatsapp",
        NOT: { providerAccountId: { startsWith: "demo-" } },
      },
      select: { id: true },
    }),
    canManageTenant(),
    loadHomeData({ tenantId, ui, lang, now }),
    loadWonLabel(tenantId, ui),
  ]);
  const tz = tenant?.timezone || "Asia/Jerusalem";
  const needsSetup = !(tenant?.intro ?? "").trim();
  const hasChannel = Boolean(liveChannel);
  const setupIncomplete = needsSetup || !hasChannel;
  const { counts } = data;

  const journey = [
    { href: "/onboard", label: ui.home.stepSetup, done: !needsSetup },
    { href: "/channels", label: ui.home.stepChannels, done: hasChannel },
    { href: "/demo", label: ui.home.stepChat, done: !needsSetup },
    { href: "/leads", label: ui.home.stepLeads, done: counts.all > 0, count: counts.needs },
  ];

  const cta =
    counts.needs > 0
      ? { href: "/leads?tab=needs", label: ui.crm.tabs.needs }
      : manager && !hasChannel
        ? { href: "/channels", label: ui.home.ctaConnect }
        : manager && needsSetup
          ? { href: "/onboard", label: ui.nav.setup }
          : { href: "/leads", label: ui.home.quickLeads };

  const summary =
    counts.needs === 0
      ? ui.home.summaryClear
      : counts.needs === 1
        ? ui.home.summaryOne
        : fillUi(ui.home.summaryNeeds, { n: counts.needs });
  const today = new Intl.DateTimeFormat(locale(lang), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  }).format(now);
  const name = tenant?.name?.trim();
  const channelLabel = hasChannel ? ui.home.whatsappOk : ui.home.whatsappOff;
  const channelPill = (
    <>
      <span className={`home-status-dot${hasChannel ? " on" : ""}`} aria-hidden="true" />
      {channelLabel}
    </>
  );

  return (
    <div className="home">
      <header className="home-hero" style={{ "--i": 0 } as CSSProperties}>
        <div className="home-hero-text">
          <p className="home-date">{today}</p>
          <h1>
            {greeting(ui, localDateAndHour(now, tz).hour)}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="home-summary">{summary}</p>
        </div>
        <div className="home-hero-actions">
          {manager ? (
            <Link href="/channels" className="home-status">
              {channelPill}
            </Link>
          ) : (
            <span className="home-status">{channelPill}</span>
          )}
          <Link href={cta.href} className="btn">
            {cta.label}
          </Link>
        </div>
      </header>

      {manager && setupIncomplete ? (
        <div className="home-reveal" style={{ "--i": 1 } as CSSProperties}>
          <SetupJourney ui={ui} steps={journey} />
        </div>
      ) : null}

      <div className="home-grid home-grid-lead">
        <NeedsPanel data={data} ui={ui} lang={lang} now={now} />
        <UpcomingPanel data={data} ui={ui} lang={lang} tz={tz} />
      </div>

      <PipelinePanel counts={counts} ui={ui} wonLabel={wonLabel} />

      <div className="home-grid home-grid-tail">
        <WeekPanel data={data} ui={ui} wonLabel={wonLabel} />
        <RecentPanel data={data} ui={ui} lang={lang} now={now} />
      </div>
    </div>
  );
}

function PanelHead({ id, title, count, href, ui }: { id: string; title: string; count?: number; href?: string; ui: UiCopy }) {
  return (
    <div className="home-panel-head">
      <h2 id={id}>
        {title}
        {count != null && count > 0 ? <span className="home-count">{count}</span> : null}
      </h2>
      {href ? (
        <Link href={href} className="home-more">
          {ui.home.viewAll}
        </Link>
      ) : null}
    </div>
  );
}

function NeedsPanel({ data, ui, lang, now }: { data: HomeData; ui: UiCopy; lang: UiLang; now: Date }) {
  const { counts, needs } = data;
  const reasons = NEEDS_REASONS.filter((r) => counts.byReason[r] > 0);
  return (
    <section
      className="card home-panel home-needs home-reveal"
      aria-labelledby="home-needs-title"
      style={{ "--i": 2 } as CSSProperties}
    >
      <PanelHead
        id="home-needs-title"
        title={ui.crm.tabs.needs}
        count={counts.needs}
        href={counts.needs > 0 ? "/leads?tab=needs" : undefined}
        ui={ui}
      />
      {reasons.length > 0 || counts.cold > 0 ? (
        <div className="home-reasons">
          {reasons.map((r) => (
            <Link key={r} href={`/leads?tab=needs&reason=${r}`} className={`crm-fu crm-fu-${r}`}>
              <Icon name={FU_ICON[r]} small />
              {ui.crm.reasons[r]}
              <span className="crm-fu-age">{counts.byReason[r]}</span>
            </Link>
          ))}
          {counts.cold > 0 ? (
            <Link href="/leads?tab=cold" className="crm-fu crm-fu-cold">
              <Icon name="cold" small />
              {fillUi(ui.home.coldLink, { n: counts.cold })}
            </Link>
          ) : null}
        </div>
      ) : null}
      {needs.length > 0 ? (
        <ul className="home-list">
          {needs.map((r) => (
            <li key={r.id}>
              <Link href={`/leads/${r.id}`} className="home-row">
                <span className="crm-av" aria-hidden="true">
                  {initials(r.name)}
                  <span className={`crm-av-ch ${avatarDotClass(r)}`} />
                </span>
                <span className="home-row-main">
                  <span className="home-row-name"><bdi>{r.name}</bdi></span>
                  <span className="home-row-sub"><bdi>{r.stand || r.handle}</bdi></span>
                </span>
                <span className="home-row-side">
                  {r.followUpReason ? (
                    <span className={`crm-fu crm-fu-${r.followUpReason}`}>
                      <Icon name={FU_ICON[r.followUpReason]} small />
                      {ui.crm.reasons[r.followUpReason]}
                    </span>
                  ) : null}
                  <span className="home-row-time">{relTime(r.followUpAt ?? r.lastAt, lang, now)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="home-empty home-empty-clear">
          <span className="home-empty-mark" aria-hidden="true">
            <Icon name="check" />
          </span>
          <div>
            <p className="home-empty-title">{ui.home.allClearTitle}</p>
            <p className="home-empty-body">{ui.home.allClearBody}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function UpcomingPanel({ data, ui, lang, tz }: { data: HomeData; ui: UiCopy; lang: UiLang; tz: string }) {
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale(lang), { ...opts, timeZone: tz }).format(new Date(iso));
  return (
    <section
      className="card home-panel home-upcoming home-reveal"
      aria-labelledby="home-upcoming-title"
      style={{ "--i": 3 } as CSSProperties}
    >
      <PanelHead id="home-upcoming-title" title={ui.home.upcomingTitle} ui={ui} />
      {data.upcoming.length > 0 ? (
        <ul className="home-list">
          {data.upcoming.map((u) => {
            const when = u.endAt
              ? `${fmt(u.startAt, { day: "numeric", month: "short" })} - ${fmt(u.endAt, { day: "numeric", month: "short" })}`
              : fmt(u.startAt, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
            return (
              <li key={u.id}>
                <Link href={`/leads/${u.leadId}`} className="home-row">
                  <span className="home-date-tile" aria-hidden="true">
                    <span className="home-date-dow">{fmt(u.startAt, { weekday: "short" })}</span>
                    <span className="home-date-day">{fmt(u.startAt, { day: "numeric" })}</span>
                  </span>
                  <span className="home-row-main">
                    <span className="home-row-name"><bdi>{u.name}</bdi></span>
                    <span className="home-row-sub">{[u.headline, u.timeText || when].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`home-tag${u.status === "approved" ? " ok" : " wait"}`}>
                    {u.status === "approved" ? ui.home.upcomingApproved : ui.home.upcomingPending}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="home-empty">
          <span className="home-empty-mark muted-mark" aria-hidden="true">
            <Icon name="cal" />
          </span>
          <p className="home-empty-body">{ui.home.upcomingEmpty}</p>
        </div>
      )}
    </section>
  );
}

function PipelinePanel({ counts, ui, wonLabel }: { counts: HomeData["counts"]; ui: UiCopy; wonLabel: string }) {
  // "Link sent" only exists for tenants that send booking links; hide it until used.
  const stages = RANKED_STAGES.filter((s) => s !== "link_sent" || counts.byStage.link_sent > 0);
  const total = stages.reduce((sum, s) => sum + counts.byStage[s], 0);
  const label = (s: PipelineStage) => (s === "won" ? wonLabel : ui.crm.stages[s]);
  const href = (s: PipelineStage) => (s === "won" ? "/leads?tab=won" : `/leads?tab=active&stage=${s}`);
  return (
    <section
      className="card home-panel home-pipeline home-reveal"
      aria-labelledby="home-pipeline-title"
      style={{ "--i": 4 } as CSSProperties}
    >
      <PanelHead id="home-pipeline-title" title={ui.home.pipelineTitle} href={total > 0 ? "/leads?tab=active" : undefined} ui={ui} />
      {total > 0 ? (
        <>
          <div className="home-bar" aria-hidden="true">
            {stages
              .filter((s) => counts.byStage[s] > 0)
              .map((s) => (
                <span key={s} className={`home-bar-seg tone-${STAGE_TONE[s]}`} style={{ flexGrow: counts.byStage[s] }} />
              ))}
          </div>
          <ol className="home-stages">
            {stages.map((s) => (
              <li key={s}>
                <Link href={href(s)} className="home-stage">
                  <span className="home-stage-label">
                    <span className={`home-stage-swatch tone-${STAGE_TONE[s]}`} aria-hidden="true" />
                    {label(s)}
                  </span>
                  <span className="home-stage-n">{counts.byStage[s]}</span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="home-empty-body home-pad">{ui.home.pipelineEmpty}</p>
      )}
    </section>
  );
}

function WeekPanel({ data, ui, wonLabel }: { data: HomeData; ui: UiCopy; wonLabel: string }) {
  const metrics = [
    { label: ui.home.metricNewLeads, value: data.week.newLeads, href: "/leads?tab=all" },
    { label: ui.home.metricAgentReplies, value: data.week.agentReplies },
    { label: ui.home.metricHandoffs, value: data.week.handoffs },
    { label: wonLabel, value: data.week.won, href: "/leads?tab=won", strong: true },
  ];
  return (
    <section
      className="card home-panel home-week home-reveal"
      aria-labelledby="home-week-title"
      style={{ "--i": 5 } as CSSProperties}
    >
      <PanelHead id="home-week-title" title={ui.home.weekTitle} ui={ui} />
      <div className="home-metrics">
        {metrics.map((m) => {
          const body = (
            <>
              <span className={`home-metric-n${m.strong ? " strong" : ""}`}>{m.value}</span>
              <span className="home-metric-label">{m.label}</span>
            </>
          );
          return m.href ? (
            <Link key={m.label} href={m.href} className="home-metric">
              {body}
            </Link>
          ) : (
            <div key={m.label} className="home-metric">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RecentPanel({ data, ui, lang, now }: { data: HomeData; ui: UiCopy; lang: UiLang; now: Date }) {
  const who = (role: string) =>
    role === "agent" ? `${ui.home.agentWrote}: ` : role === "human" ? `${ui.home.youWrote}: ` : "";
  return (
    <section
      className="card home-panel home-recent home-reveal"
      aria-labelledby="home-recent-title"
      style={{ "--i": 6 } as CSSProperties}
    >
      <PanelHead
        id="home-recent-title"
        title={ui.home.recentTitle}
        href={data.recent.length > 0 ? "/leads?tab=all" : undefined}
        ui={ui}
      />
      {data.recent.length > 0 ? (
        <ul className="home-list">
          {data.recent.map((c) => (
            <li key={c.id}>
              <Link href={`/leads/${c.id}`} className={`home-row${c.unread ? " unread" : ""}`}>
                <span className="crm-av" aria-hidden="true">
                  {initials(c.name)}
                  <span className={`crm-av-ch ${c.channel === "whatsapp" ? "wa" : "ig"}`} />
                </span>
                <span className="home-row-main">
                  <span className="home-row-name"><bdi>{c.name}</bdi></span>
                  <span className="home-row-sub">
                    {who(c.lastRole)}
                    <bdi>{c.lastText || ui.common.empty}</bdi>
                  </span>
                </span>
                <span className="home-row-side">
                  <span className="home-row-time">{relTime(c.at, lang, now)}</span>
                  {c.unread ? <span className="home-unread" aria-hidden="true" /> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="home-empty">
          <span className="home-empty-mark muted-mark" aria-hidden="true">
            <Icon name="msg" />
          </span>
          <div>
            <p className="home-empty-body">{ui.home.recentEmpty}</p>
            <Link href="/demo" className="btn btn-secondary home-empty-cta">
              {ui.home.tryChat}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
