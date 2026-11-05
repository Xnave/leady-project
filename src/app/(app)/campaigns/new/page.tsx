import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CampaignEditor } from "@/components/campaigns/CampaignEditor";
import { campaignPageAccess, editorData, pickedLeadIds } from "@/lib/campaigns/page-data";
import { termsAccepted } from "@/lib/campaigns/settings";
import { getUiLang } from "@/lib/cookies";
import { uiCopy } from "@/lib/ui";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ leads?: string }> }) {
  const { tenantId, settings } = await campaignPageAccess();
  if (!termsAccepted(settings)) redirect("/campaigns?tab=templates");
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [data, leadIds] = await Promise.all([editorData(tenantId), pickedLeadIds(tenantId, (await searchParams).leads)]);

  return (
    <div>
      <PageHeader title={ui.campaigns.run.newCampaign} />
      <p>
        <Link href="/campaigns" className="btn-ghost">
          {ui.campaigns.run.back}
        </Link>
      </p>
      <CampaignEditor copy={ui.campaigns.run} confidenceNames={ui.clientSources.confidence} lang={lang} data={data} pickedLeadIds={leadIds} initial={null} />
    </div>
  );
}
