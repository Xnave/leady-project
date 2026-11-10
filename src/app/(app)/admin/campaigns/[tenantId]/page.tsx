import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { AdminCampaignSettings } from "@/components/campaigns/AdminCampaignSettings";
import { isAdminSession } from "@/lib/admin";
import { loadCampaignSettings, tenantWhatsAppAccount } from "@/lib/campaigns/store";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { fillUi, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

/** Platform admins: client campaigns add-on and legal settings for one tenant. */
export default async function AdminCampaignsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!(await isAdminSession())) redirect("/admin");
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) notFound();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [settings, account] = await Promise.all([loadCampaignSettings(tenantId), tenantWhatsAppAccount(tenantId)]);

  return (
    <div>
      <PageHeader title={fillUi(ui.campaigns.admin.title, { name: tenant.name })} />
      <p>
        <Link href="/admin" className="btn-ghost">
          {ui.campaigns.admin.back}
        </Link>
      </p>
      <AdminCampaignSettings
        tenantId={tenantId}
        copy={ui.campaigns.admin}
        lang={lang}
        initial={settings}
        whatsappPhone={account?.phone ?? null}
      />
    </div>
  );
}
