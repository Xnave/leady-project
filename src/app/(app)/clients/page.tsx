import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ClientsSyncButton } from "@/components/client-sources/ClientsSyncButton";
import { absTime } from "@/components/crm/format";
import { getConnector } from "@/lib/client-sources/registry";
import { CLIENTS_PAGE_SIZE, listClients, parseClientFilters, type ClientListFilters } from "@/lib/client-sources/list";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/leads";
import { requireTenantRoleForPage } from "@/lib/tenant-role";
import { fillUi, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

function monthYear(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function pageHref(f: ClientListFilters, page: number): string {
  const qs = new URLSearchParams();
  if (f.q) qs.set("q", f.q);
  if (f.confidence) qs.set("confidence", f.confidence);
  if (f.dealFrom != null) qs.set("from", String(f.dealFrom));
  if (f.dealTo != null) qs.set("to", String(f.dealTo));
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/clients?${s}` : "/clients";
}

/** Owner/admin: clients synced from the tenant's own CRM. Read-only. Not leads. */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await requireTenantRoleForPage("manager");
  const sources = await prisma.clientSource.findMany({
    where: { tenantId },
    select: { kind: true, lastSyncAt: true, status: true },
  });
  if (!sources.length) redirect("/");

  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const copy = ui.clientSources.page;
  const filters = parseClientFilters(await searchParams);
  const { total, rows } = await listClients(tenantId, filters);
  const filtered = Boolean(filters.q || filters.confidence || filters.dealFrom != null || filters.dealTo != null);
  const lastSync = sources
    .map((s) => s.lastSyncAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const pages = Math.max(1, Math.ceil(total / CLIENTS_PAGE_SIZE));

  const sourceLabel = (kind: string, field: string) => {
    const def = getConnector(kind)?.fieldCatalog.find((f) => f.key === field);
    return def ? def.label[lang] : field;
  };

  return (
    <div>
      <PageHeader
        title={copy.title}
        blurb={copy.blurb}
        actions={<ClientsSyncButton labels={copy} />}
      />
      <p className="muted clients-meta">
        <span>{fillUi(copy.total, { n: total })}</span>
        <span>{lastSync ? fillUi(copy.lastSync, { when: absTime(lastSync.toISOString(), lang) }) : copy.never}</span>
        {sources.some((s) => s.status === "error") ? <span className="badge badge-warn">{ui.clientSources.statuses.error}</span> : null}
      </p>

      <form className="toolbar clients-toolbar" method="get" action="/clients">
        <label>
          {copy.search}
          <input name="q" defaultValue={filters.q} />
        </label>
        <label>
          {copy.confidenceLabel}
          <select name="confidence" defaultValue={filters.confidence}>
            <option value="">{copy.confidenceAll}</option>
            {(["high", "medium_high", "medium", "low"] as const).map((c) => (
              <option key={c} value={c}>
                {ui.clientSources.confidence[c]}
              </option>
            ))}
            <option value="none">{copy.confidenceNone}</option>
          </select>
        </label>
        <label>
          {copy.dealFrom}
          <input name="from" type="number" min={1970} max={2100} defaultValue={filters.dealFrom ?? ""} />
        </label>
        <label>
          {copy.dealTo}
          <input name="to" type="number" min={1970} max={2100} defaultValue={filters.dealTo ?? ""} />
        </label>
        <button type="submit" className="btn-secondary">
          {copy.filter}
        </button>
        {filtered ? (
          <Link href="/clients" className="btn-ghost">
            {copy.clear}
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>{filtered ? copy.emptyFiltered : copy.empty}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{copy.cols.name}</th>
                <th>{copy.cols.phone}</th>
                <th>{copy.cols.dealDate}</th>
                <th>{copy.cols.source}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name || "-"}{" "}
                    {c.leadId ? (
                      <Link href={`/leads/${encodeURIComponent(c.leadId)}`} className="badge">
                        {copy.linkedLead}
                      </Link>
                    ) : null}
                  </td>
                  <td dir="ltr">
                    {c.phoneStatus === "ok" ? (
                      formatPhoneDisplay(c.phone)
                    ) : (
                      <span className="badge badge-warn">{c.phoneStatus === "missing" ? copy.phoneMissing : copy.phoneInvalid}</span>
                    )}
                  </td>
                  <td>{c.dealDate ? monthYear(c.dealDate) : "-"}</td>
                  <td className="muted">
                    {c.dealDateSource
                      ? `${sourceLabel(c.source.kind, c.dealDateSource)} · ${ui.clientSources.confidence[c.dealDateConfidence as keyof typeof ui.clientSources.confidence] ?? c.dealDateConfidence}`
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav className="clients-pager">
          {filters.page > 1 ? (
            <Link className="btn-ghost" href={pageHref(filters, filters.page - 1)}>
              {copy.prev}
            </Link>
          ) : null}
          <span className="muted">
            {filters.page} / {pages}
          </span>
          {filters.page < pages ? (
            <Link className="btn-ghost" href={pageHref(filters, filters.page + 1)}>
              {copy.next}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
