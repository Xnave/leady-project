import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SetupJourney } from "@/components/SetupJourney";
import { prisma } from "@/lib/db";
import { getNavCounts } from "@/lib/nav-counts";
import { getUiLang } from "@/lib/cookies";
import { requireTenantIdForPage } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantId = await requireTenantIdForPage();
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

  return (
    <div>
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
    </div>
  );
}
