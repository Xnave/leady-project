import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { CampaignTemplates } from "@/components/campaigns/CampaignTemplates";
import { termsAccepted } from "@/lib/campaigns/settings";
import { footerPhone, loadCampaignSettings, tenantWhatsAppAccount } from "@/lib/campaigns/store";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { requireTenantRoleForPage } from "@/lib/tenant-role";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

/** Client campaigns add-on. PR 1: terms and templates; campaigns and clients tabs come later. */
export default async function CampaignsPage() {
  const access = await requireTenantRoleForPage("manager");
  const settings = await loadCampaignSettings(access.tenantId);
  if (!settings.enabled) redirect("/");
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [account, tenant] = await Promise.all([
    tenantWhatsAppAccount(access.tenantId),
    prisma.tenant.findUnique({ where: { id: access.tenantId }, select: { name: true } }),
  ]);
  // Same number in "Sent from" and in the template footer that Meta receives.
  const phone = footerPhone(account);

  return (
    <div>
      <PageHeader title={ui.campaigns.title} blurb={ui.campaigns.blurb} />
      <CampaignTemplates
        copy={ui.campaigns}
        lang={lang}
        initialTermsAccepted={termsAccepted(settings)}
        adPrefixEnabled={settings.adPrefixEnabled}
        business={{ name: tenant?.name ?? "", phone }}
        whatsappPhone={phone || null}
      />
    </div>
  );
}
