import { redirect } from "next/navigation";
import { getUiLang } from "@/lib/cookies";
import { hasClientsScreen } from "@/lib/documents/clients-nav";
import { isClientTab, listClientCases, loadClientCase } from "@/lib/documents/clients-view";
import { requireTenantRoleForPage } from "@/lib/tenant-role";
import { uiCopy } from "@/lib/ui";
import { ClientsScreen, type ClientsQuery } from "./ClientsScreen";

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** /clients and /clients/[key] render the same split screen; the key picks the open client. */
export async function renderClients(searchParams: Params, key: string | null) {
  const { tenantId } = await requireTenantRoleForPage("manager");
  if (!(await hasClientsScreen(tenantId))) redirect("/");
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tab = one(searchParams, "tab");
  const page = Number(one(searchParams, "page"));
  const query: ClientsQuery = {
    tab: isClientTab(tab) ? tab : "needs",
    q: one(searchParams, "q").slice(0, 80),
    showTest: one(searchParams, "test") === "1",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
  const [list, selected] = await Promise.all([
    listClientCases({ tenantId, ...query, lang }),
    key ? loadClientCase({ tenantId, key, lang }) : Promise.resolve(undefined),
  ]);
  // Land on the first tab with work in it when the URL names none.
  if (!tab && !key && list.counts.needs === 0) {
    const fallback = list.counts.collecting ? "collecting" : list.counts.invited ? "invited" : list.counts.done ? "done" : "all";
    redirect(`/clients?tab=${fallback}${query.showTest ? "&test=1" : ""}`);
  }
  return (
    <ClientsScreen
      ui={ui}
      lang={lang}
      query={query}
      rows={list.rows}
      counts={list.counts}
      total={list.total}
      hiddenTest={list.hiddenTest}
      testOnly={list.testOnly}
      selected={selected}
      selectedKey={key}
    />
  );
}
