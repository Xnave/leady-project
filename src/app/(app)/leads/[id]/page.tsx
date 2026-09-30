import { LeadPage } from "@/components/crm/LeadPage";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { loadLeadView } from "@/lib/crm/view";
import { loadWonLabel } from "@/lib/crm/won-label";
import { requireTenantIdForPage } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);

  const dto = await loadLeadView(tenantId, id, ui, lang);
  if (!dto) notFound();
  if (dto.unread) {
    await prisma.lead.updateMany({ where: { id, tenantId }, data: { adminUnread: false } });
  }
  const wonLabel = await loadWonLabel(tenantId, ui);
  return <LeadPage dto={dto} ui={ui} lang={lang} wonLabel={wonLabel} />;
}
