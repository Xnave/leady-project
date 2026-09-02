import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SetupJourney } from "@/components/SetupJourney";
import { prisma } from "@/lib/db";
import { getNavCounts } from "@/lib/nav-counts";
import { getUiLang } from "@/lib/cookies";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [tenant, counts, liveChannel] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId } }),
    getNavCounts(tenantId),
    prisma.channelConnection.findFirst({
      where: {
        tenantId,
        provider: "whatsapp",
        NOT: { providerAccountId: { startsWith: "demo-" } },
      },
    }),
  ]);
  const needsSetup = !(tenant?.intro ?? "").trim();
  const hasChannel = Boolean(liveChannel);

  const cards = [
    {
      href: "/onboard",
      title: ui.home.quickSetup,
      blurb: ui.page.setupBlurb,
      count: needsSetup ? 1 : 0,
    },
    {
      href: "/demo",
      title: ui.home.quickChat,
      blurb: ui.chat.startNew,
    },
    {
      href: "/leads",
      title: ui.home.quickLeads,
      blurb: ui.page.leadsTitle,
      count: counts.leads,
    },
    {
      href: "/inbox",
      title: ui.home.quickInbox,
      blurb: ui.page.inboxTitle,
      count: counts.inbox,
    },
    {
      href: "/channels",
      title: ui.home.quickChannels,
      blurb: ui.page.channelsTitle,
      count: hasChannel ? 0 : 1,
    },
  ];

  const journey = [
    { href: "/onboard", label: ui.home.stepSetup, done: !needsSetup },
    { href: "/channels", label: ui.home.stepChannels, done: hasChannel },
    { href: "/demo", label: ui.home.stepChat, done: !needsSetup },
    { href: "/leads", label: ui.home.stepLeads, done: counts.leads > 0, count: counts.leads },
    { href: "/inbox", label: ui.home.stepInbox, done: counts.inbox === 0, count: counts.inbox },
  ];

  return (
    <div>
      <PageHeader
        title={ui.page.homeTitle}
        blurb={
          tenant
            ? `${ui.home.tenantLabel}: ${tenant.name}${needsSetup ? ` · ${ui.page.homeSetup}` : ""}`
            : ui.page.homeBlurb
        }
      />
      <SetupJourney ui={ui} steps={journey} />
      {needsSetup ? (
        <div className="card">
          <p>
            {ui.page.homeSetup}{" "}
            <Link href="/onboard">{ui.nav.setup}</Link>
          </p>
        </div>
      ) : null}
      <div className="dashboard-grid">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="card card-interactive dashboard-card">
            <div className="channel-row">
              <h3>{card.title}</h3>
              {card.count && card.count > 0 ? (
                <span className="nav-badge">{card.count > 99 ? "99+" : card.count}</span>
              ) : null}
            </div>
            <p>{card.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
