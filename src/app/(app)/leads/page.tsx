import { LeadsList } from "@/components/crm/LeadsList";
import { getUiLang } from "@/lib/cookies";
import { crmV2Enabled } from "@/lib/crm/flags";
import { loadLeadRows, type CrmTab } from "@/lib/crm/view";
import { isPipelineStage } from "@/lib/crm/types";
import { prisma } from "@/lib/db";
import { requireTenantIdForPage } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";
import { LegacyLeadsList } from "./LegacyLeadsList";

export const dynamic = "force-dynamic";
const TABS: CrmTab[] = ["needs", "active", "won", "closed", "all"];
/** R6: the needs tab is one un-paginated list of up to 200 rows (the loader's cap). */
const NEEDS_CAP = 200;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tenantId = await requireTenantIdForPage();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { crmV2: true } });
  if (!crmV2Enabled(tenant)) return <LegacyLeadsList searchParams={Promise.resolve(sp)} />;

  const lang = await getUiLang();
  const ui = uiCopy(lang);
  // 10 stays accepted because the shared <Pagination> offers it.
  const pageSize = [10, 20, 50].includes(Number(sp.size)) ? Number(sp.size) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const stage = isPipelineStage(sp.stage) ? sp.stage : undefined;
  const channel = sp.ch === "whatsapp" || sp.ch === "instagram" ? sp.ch : undefined;
  const q = sp.q?.trim() ?? "";
  const showDemo = sp.demo === "1";
  const instances = await prisma.capabilityInstance.findMany({
    where: { tenantId, enabled: true },
    select: { capabilityId: true },
  });
  const caps = [...new Set(instances.map((i) => i.capabilityId))];
  const wonLabel = (caps.length === 1 && ui.crm.wonByCapability[caps[0]]) || ui.crm.stages.won;

  const load = (t: CrmTab) =>
    loadLeadRows({
      tenantId,
      tab: t,
      stage,
      channel,
      q,
      showDemo,
      page: t === "needs" ? 1 : page,
      pageSize: t === "needs" ? NEEDS_CAP : pageSize,
      ui,
      lang,
    });

  // Default to "needs" when anything needs the owner, else "active".
  let tab = TABS.includes(sp.tab as CrmTab) ? (sp.tab as CrmTab) : undefined;
  let data = await load(tab ?? "needs");
  if (!tab && data.counts.needs === 0) {
    tab = "active";
    data = await load(tab);
  }

  return (
    <LeadsList
      initialRows={data.rows}
      counts={data.counts}
      total={data.total}
      tab={tab ?? "needs"}
      stage={stage}
      channel={channel}
      q={q}
      page={page}
      pageSize={pageSize}
      wonLabel={wonLabel}
      ui={ui}
      lang={lang}
    />
  );
}
