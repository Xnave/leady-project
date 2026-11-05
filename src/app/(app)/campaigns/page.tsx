import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CampaignTemplates } from "@/components/campaigns/CampaignTemplates";
import { absTime } from "@/components/crm/format";
import { listCampaigns } from "@/lib/campaigns/manage";
import { campaignPageAccess } from "@/lib/campaigns/page-data";
import { termsAccepted } from "@/lib/campaigns/settings";
import { tenantWhatsAppAccount } from "@/lib/campaigns/store";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/leads";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

/** Client campaigns add-on: campaigns (default) and templates tabs. */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tenantId, settings } = await campaignPageAccess();
  const tab = (await searchParams).tab === "templates" ? "templates" : "campaigns";
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const run = ui.campaigns.run;

  const tabs = (
    <nav className="campaign-tabs" aria-label={ui.campaigns.title}>
      <Link href="/campaigns" className={tab === "campaigns" ? "active" : ""} aria-current={tab === "campaigns" ? "page" : undefined}>
        {run.tabs.campaigns}
      </Link>
      <Link href="/campaigns?tab=templates" className={tab === "templates" ? "active" : ""} aria-current={tab === "templates" ? "page" : undefined}>
        {run.tabs.templates}
      </Link>
    </nav>
  );

  if (tab === "templates") {
    const [account, tenant] = await Promise.all([
      tenantWhatsAppAccount(tenantId),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, phone: true } }),
    ]);
    const phone = account ? formatPhoneDisplay(account.phone) || account.phone : null;
    return (
      <div>
        <PageHeader title={ui.campaigns.title} blurb={ui.campaigns.blurb} />
        {tabs}
        <CampaignTemplates
          copy={ui.campaigns}
          lang={lang}
          initialTermsAccepted={termsAccepted(settings)}
          adPrefixEnabled={settings.adPrefixEnabled}
          business={{ name: tenant?.name ?? "", phone: tenant?.phone ?? "" }}
          whatsappPhone={phone}
        />
      </div>
    );
  }

  const campaigns = await listCampaigns(tenantId);
  return (
    <div>
      <PageHeader
        title={ui.campaigns.title}
        blurb={ui.campaigns.blurb}
        actions={
          termsAccepted(settings) ? (
            <Link href="/campaigns/new" className="btn">
              {run.newCampaign}
            </Link>
          ) : null
        }
      />
      {tabs}
      {!termsAccepted(settings) ? <p className="muted">{run.errors.terms_required}</p> : null}
      {campaigns.length === 0 ? (
        <div className="empty-state">
          <p>{run.listEmpty}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{run.cols.name}</th>
                <th>{run.cols.template}</th>
                <th>{run.cols.status}</th>
                <th>{run.cols.when}</th>
                <th>{run.cols.sent}</th>
                <th>{run.cols.skipped}</th>
                <th>{run.cols.failed}</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/campaigns/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                  </td>
                  <td className="muted">{c.templateTitle}</td>
                  <td>
                    <span className={`badge${c.status === "paused" ? " badge-warn" : ""}`}>
                      {run.statuses[c.status as keyof typeof run.statuses] ?? c.status}
                    </span>
                  </td>
                  <td className="muted">{c.scheduledAt ? absTime(c.scheduledAt, lang) : "-"}</td>
                  <td>{c.metrics.sent}</td>
                  <td>{c.metrics.skipped}</td>
                  <td>{c.metrics.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
