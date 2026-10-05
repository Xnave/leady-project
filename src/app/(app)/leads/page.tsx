import { LeadsList } from "@/components/crm/LeadsList";
import { getUiLang } from "@/lib/cookies";
import { isQueueTab, loadLeadRows, type CrmCounts, type CrmTab } from "@/lib/crm/view";
import { isFollowUpReason, isPipelineStage } from "@/lib/crm/types";
import { loadWonLabel } from "@/lib/crm/won-label";
import { logCrmPerf } from "@/lib/perf";
import { requireTenantIdForPage } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";
const TABS: CrmTab[] = ["needs", "cold", "active", "won", "closed", "all"];
/** R6: the queue tabs (needs, cold) are one un-paginated list of up to 200 rows (the loader's cap). */
const QUEUE_CAP = 200;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const started = Date.now();
  const sp = await searchParams;
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  // 10 stays accepted because the shared <Pagination> offers it.
  const pageSize = [10, 20, 50].includes(Number(sp.size)) ? Number(sp.size) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const stage = isPipelineStage(sp.stage) ? sp.stage : undefined;
  const reason = isFollowUpReason(sp.reason) ? sp.reason : undefined;
  const channel = sp.ch === "whatsapp" || sp.ch === "instagram" ? sp.ch : undefined;
  const q = sp.q?.trim() ?? "";
  const showDemo = sp.demo === "1";

  const load = (t: CrmTab, counts?: CrmCounts) =>
    loadLeadRows({
      tenantId,
      tab: t,
      stage,
      reason: t === "needs" ? reason : undefined,
      channel,
      q,
      showDemo,
      page: isQueueTab(t) ? 1 : page,
      pageSize: isQueueTab(t) ? QUEUE_CAP : pageSize,
      ui,
      lang,
      skipCounts: Boolean(counts),
      counts,
    });

  // Default to the first non-empty of: Needs you, Gone cold, Active.
  let tab = TABS.includes(sp.tab as CrmTab) ? (sp.tab as CrmTab) : undefined;
  const [wonLabel, first] = await Promise.all([loadWonLabel(tenantId, ui), load(tab ?? "needs")]);
  let data = first;
  if (!tab && data.counts.needs === 0) {
    tab = data.counts.cold > 0 ? "cold" : "active";
    data = await load(tab, data.counts);
  }

  logCrmPerf("crm.leads_page", {
    tenantId,
    tab: tab ?? "needs",
    row_count: data.rows.length,
    ms: Date.now() - started,
  });

  return (
    <LeadsList
      initialRows={data.rows}
      counts={data.counts}
      total={data.total}
      tab={tab ?? "needs"}
      stage={stage}
      reason={reason}
      channel={channel}
      q={q}
      page={page}
      pageSize={pageSize}
      wonLabel={wonLabel}
      ui={ui}
      lang={lang}
      nowIso={new Date().toISOString()}
    />
  );
}
