import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  const needsSetup = !(tenant?.intro ?? "").trim();

  const cards = [
    { href: "/onboard", title: ui.home.quickSetup, blurb: ui.page.setupBlurb },
    { href: "/demo", title: ui.home.quickChat, blurb: ui.chat.startNew },
    { href: "/leads", title: ui.home.quickLeads, blurb: ui.page.leadsTitle },
    { href: "/inbox", title: ui.home.quickInbox, blurb: ui.page.inboxTitle },
    { href: "/channels", title: ui.home.quickChannels, blurb: ui.page.channelsTitle },
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
            <h3>{card.title}</h3>
            <p>{card.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
