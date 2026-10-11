import { PageHeader } from "@/components/PageHeader";
import { LegalCard } from "@/components/legal/LegalCard";
import { getUiLang } from "@/lib/cookies";
import { requireTenantIdForPage } from "@/lib/tenant";
import { isTenantOwner } from "@/lib/tenant-role";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

/** Reached from the avatar menu. Everyone sees the privacy policy; the owner also sees the signed agreement. */
export default async function LegalPage() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tenantId = await requireTenantIdForPage();
  const owner = await isTenantOwner();

  return (
    <div>
      <PageHeader title={ui.legal.card.title} />
      <LegalCard tenantId={tenantId} owner={owner} ui={ui} lang={lang} />
    </div>
  );
}
