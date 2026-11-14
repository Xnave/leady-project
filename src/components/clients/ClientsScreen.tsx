import Link from "next/link";
import { Icon } from "@/components/crm/Icon";
import { initials, relTime } from "@/components/crm/format";
import {
  CLIENT_TABS,
  CLIENTS_CASE_PAGE,
  type ClientCaseDTO,
  type ClientRowDTO,
  type ClientTab,
  type Segment,
} from "@/lib/documents/clients-view";
import { fillUi, type UiCopy, type UiLang } from "@/lib/ui";
import { ClientCase } from "./ClientCase";

export type ClientsQuery = { tab: ClientTab; q: string; showTest: boolean; page: number };

/** Keeps tab, search and the test toggle on every link inside the screen. */
export function clientsHref(path: string, query: ClientsQuery, over: Partial<ClientsQuery> = {}): string {
  const next = { ...query, ...over };
  const qs = new URLSearchParams();
  if (next.tab !== "needs") qs.set("tab", next.tab);
  if (next.q) qs.set("q", next.q);
  if (next.showTest) qs.set("test", "1");
  if (next.page > 1) qs.set("page", String(next.page));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

function Progress({ segments, label }: { segments: Segment[]; label: string }) {
  if (!segments.length) return null;
  return (
    <span className="cl-progress" role="img" aria-label={label}>
      {segments.map((segment, index) => (
        <span key={index} className={`cl-seg ${segment}`} />
      ))}
    </span>
  );
}

function StateChip({ row, ui }: { row: ClientRowDTO; ui: UiCopy }) {
  const t = ui.clientsUi;
  if (row.state === "needs_you") {
    return <span className="cl-chip needs">{row.taskKind === "advisor" ? t.taskAdvisor : t.taskReview}</span>;
  }
  if (row.state === "complete") {
    return row.nextWaveReady
      ? <span className="cl-chip ready">{t.nextWaveReady}</span>
      : <span className="cl-chip done"><Icon name="check" small />{t.states.complete}</span>;
  }
  if ((row.state === "collecting" || row.state === "waiting_id") && row.stuckDays >= 4) {
    return <span className="cl-chip warn">{fillUi(t.stuck, { n: row.stuckDays })}</span>;
  }
  return <span className={`cl-chip ${row.state === "not_started" ? "idle" : ""}`}>{t.states[row.state]}</span>;
}

function ClientRow({
  row,
  href,
  active,
  ui,
  lang,
  now,
}: {
  row: ClientRowDTO;
  href: string;
  active: boolean;
  ui: UiCopy;
  lang: UiLang;
  now: Date;
}) {
  const t = ui.clientsUi;
  const progress = row.total ? fillUi(t.progress, { done: row.done, total: row.total }) : "";
  return (
    <li>
      <Link href={href} className={`cl-row${active ? " active" : ""}`} aria-current={active ? "page" : undefined} scroll={false}>
        <span className={`cl-avatar ${row.state}`} aria-hidden="true">{initials(row.name)}</span>
        <span className="cl-row-main">
          <span className="cl-row-top">
            <bdi className="cl-name">{row.name}</bdi>
            {row.test ? <span className="cl-chip test">{t.testChip}</span> : null}
            <span className="cl-time">
              {row.lastActivity ? relTime(row.lastActivity, lang, now) : ""}
            </span>
          </span>
          <span className="cl-row-bottom">
            {row.total ? (
              <>
                <Progress segments={row.segments} label={progress} />
                <span className="cl-count">{progress}</span>
              </>
            ) : (
              <span className="cl-phone" dir="ltr">{row.phone}</span>
            )}
            <StateChip row={row} ui={ui} />
          </span>
          {row.waveCount > 1 && row.total ? (
            <span className="cl-wave">{fillUi(t.waveOf, { n: row.waveIndex + 1, total: row.waveCount })} · {row.waveLabel}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function ClientsScreen({
  ui,
  lang,
  query,
  rows,
  counts,
  total,
  hiddenTest,
  testOnly,
  selected,
  selectedKey,
}: {
  ui: UiCopy;
  lang: UiLang;
  query: ClientsQuery;
  rows: ClientRowDTO[];
  counts: Record<ClientTab, number>;
  total: number;
  hiddenTest: number;
  testOnly: boolean;
  selected: ClientCaseDTO | null | undefined;
  selectedKey: string | null;
}) {
  const t = ui.clientsUi;
  const now = new Date();
  const pages = Math.max(1, Math.ceil(total / CLIENTS_CASE_PAGE));
  const hasDetail = Boolean(selectedKey);
  return (
    <div className={`cl-screen${hasDetail ? " has-detail" : ""}`}>
      <header className="cl-head">
        <div className="cl-head-text">
          <h1>{t.title}</h1>
          <p className="muted">{t.blurb}</p>
        </div>
      </header>

      {testOnly ? <p className="cl-testmode">{t.testMode}</p> : null}

      <div className="cl-split">
        <section className="cl-listpane" aria-label={t.title}>
          <nav className="cl-tabs" aria-label={t.title}>
            {CLIENT_TABS.map((tab) => (
              <Link
                key={tab}
                href={clientsHref("/clients", query, { tab, page: 1 })}
                className={`cl-tab${tab === "needs" && counts.needs > 0 ? " needs" : ""}`}
                aria-current={tab === query.tab ? "page" : undefined}
                scroll={false}
              >
                {t.tabs[tab]}
                <span className="cl-tab-count">{counts[tab]}</span>
              </Link>
            ))}
          </nav>

          <form className="cl-search" method="get" action="/clients" role="search">
            <input type="hidden" name="tab" value={query.tab} />
            {query.showTest ? <input type="hidden" name="test" value="1" /> : null}
            <label className="cl-search-field">
              <span className="sr-only">{t.search}</span>
              <Icon name="search" small />
              <input name="q" type="search" defaultValue={query.q} placeholder={t.search} autoComplete="off" enterKeyHint="search" />
            </label>
            {hiddenTest || query.showTest ? (
              <Link className="cl-testtoggle" href={clientsHref(selectedKey ? `/clients/${selectedKey}` : "/clients", query, { showTest: !query.showTest })} scroll={false}>
                {query.showTest ? t.hideTest : fillUi(t.hiddenTest, { n: hiddenTest })}
              </Link>
            ) : null}
          </form>

          {rows.length === 0 ? (
            <div className="cl-empty">
              <span className="cl-empty-icon" aria-hidden="true"><Icon name="inbox" /></span>
              <p>{query.q ? t.emptySearch : t.empty[query.tab]}</p>
            </div>
          ) : (
            <ul className="cl-list">
              {rows.map((row) => (
                <ClientRow
                  key={row.key}
                  row={row}
                  href={clientsHref(`/clients/${row.key}`, query)}
                  active={row.key === selectedKey}
                  ui={ui}
                  lang={lang}
                  now={now}
                />
              ))}
            </ul>
          )}

          {pages > 1 ? (
            <nav className="cl-pager">
              {query.page > 1 ? (
                <Link className="btn-ghost" href={clientsHref("/clients", query, { page: query.page - 1 })}>{t.prev}</Link>
              ) : <span />}
              <span className="muted">{fillUi(t.pageOf, { page: query.page, pages })}</span>
              {query.page < pages ? (
                <Link className="btn-ghost" href={clientsHref("/clients", query, { page: query.page + 1 })}>{t.next}</Link>
              ) : <span />}
            </nav>
          ) : null}
        </section>

        <section className="cl-detailpane" aria-live="polite">
          {selected ? (
            <ClientCase
              key={selected.key}
              data={selected}
              ui={ui}
              lang={lang}
              now={now.toISOString()}
              backHref={clientsHref("/clients", query)}
            />
          ) : selectedKey ? (
            <div className="cl-placeholder">
              <Link className="cl-back" href={clientsHref("/clients", query)}><Icon name="chevron" small />{t.back}</Link>
              <p>{t.notFound}</p>
            </div>
          ) : (
            <div className="cl-placeholder">
              <span className="cl-empty-icon" aria-hidden="true"><Icon name="file" /></span>
              <p className="cl-placeholder-title">{t.pickTitle}</p>
              <p className="muted">{t.pickBody}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
