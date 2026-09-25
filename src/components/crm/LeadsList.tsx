"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Pagination } from "@/components/Pagination";
import type { CrmCounts, CrmTab, LeadRowDTO } from "@/lib/crm/view";
import type { PipelineStage } from "@/lib/crm/types";
import type { UiCopy } from "@/lib/ui";
import { BulkBar } from "./BulkBar";
import { LeadsGrid } from "./LeadsGrid";
import { LeadsHeader } from "./LeadsHeader";
import { ListBar } from "./ListBar";
import { ListMenus, type OpenMenu } from "./ListMenus";
import { PipelineStrip } from "./PipelineStrip";
import { isSnoozable, type ViewFilter } from "./rows";
import { ToastProvider } from "./Toasts";
import { useLeadRows } from "./useLeadRows";
import { useListKeyboard } from "./useListKeyboard";
import type { RowMenu } from "./LeadRow";

type Props = {
  initialRows: LeadRowDTO[];
  counts: CrmCounts;
  total: number;
  tab: CrmTab;
  stage?: PipelineStage;
  channel?: string;
  q: string;
  page: number;
  pageSize: number;
  wonLabel: string;
  ui: UiCopy;
  lang: "he" | "en";
};

const SEARCH_DEBOUNCE_MS = 250;

export function LeadsList(props: Props) {
  return (
    <ToastProvider undoLabel={props.ui.crm.undo}>
      <LeadsListInner {...props} />
    </ToastProvider>
  );
}

function LeadsListInner({ initialRows, counts, total, tab, stage, channel, q, page, pageSize, wonLabel, ui, lang }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();

  // View state mirrors the URL, but updates at once on click so the tabs never lag.
  const propView: ViewFilter = { tab, stage, channel };
  const [view, setView] = useState<ViewFilter>(propView);
  const [qInput, setQInput] = useState(q);
  const searchRef = useRef<HTMLInputElement>(null);
  const [seen, setSeen] = useState({ tab, stage, channel, q });
  if (seen.tab !== tab || seen.stage !== stage || seen.channel !== channel || seen.q !== q) {
    setSeen({ tab, stage, channel, q });
    setView(propView);
    if (typeof document === "undefined" || document.activeElement !== searchRef.current) setQInput(q);
  }

  const { rows, leaving, setStage, snooze, setNextStep, markRead } = useLeadRows({ initialRows, view, ui, lang, wonLabel });
  const [kb, setKb] = useState(0);
  const [kbNav, setKbNav] = useState(false);
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [now, setNow] = useState(() => new Date());
  const qTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cursor = Math.min(kb, Math.max(0, rows.length - 1));

  // Client clock for relative times; ticks once a minute.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const base = `${ui.product} · ${ui.page.leadsTitle}`;
    document.title = counts.needs ? `(${counts.needs}) ${base}` : base;
  }, [counts.needs, ui]);

  const navigate = useCallback(
    (next: ViewFilter & { q: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      const set = (k: string, v?: string) => (v ? params.set(k, v) : params.delete(k));
      set("tab", next.tab);
      set("stage", next.stage);
      set("ch", next.channel);
      set("q", next.q.trim());
      params.delete("page");
      setView({ tab: next.tab, stage: next.stage, channel: next.channel });
      setKb(0);
      setSel(new Set());
      startNav(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const onQ = (value: string) => {
    setQInput(value);
    clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => navigate({ ...view, q: value }), SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => clearTimeout(qTimer.current), []);

  // Task 11 replaces this with the peek panel.
  const openLead = useCallback((id: string) => router.push(`/leads/${id}`), [router]);

  const onCheck = useCallback((id: string, on: boolean) => {
    setSel((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onMenu = useCallback((kind: RowMenu, id: string, anchor: HTMLElement) => {
    setMenu({ kind, ids: [id], anchor });
  }, []);

  const rowEl = (i: number) => (rows[i] ? document.querySelector<HTMLElement>(`[data-row="${rows[i].id}"]`) : null);

  useListKeyboard({
    count: rows.length,
    kb: cursor,
    menuOpen: menu !== null,
    moveTo: (i) => {
      setKbNav(true);
      setKb(i);
      rowEl(i)?.scrollIntoView({ block: "nearest" });
    },
    open: (i) => rows[i] && openLead(rows[i].id),
    menu: (kind, i) => {
      const el = rowEl(i);
      const anchor = el?.querySelector<HTMLElement>("[data-stage-btn]");
      if (el && anchor) setMenu({ kind, ids: [rows[i].id], anchor, returnFocus: el });
    },
    canSnooze: (i) => Boolean(rows[i] && isSnoozable(rows[i])),
    escape: () => {
      if (sel.size) setSel(new Set());
      else (document.activeElement as HTMLElement | null)?.blur();
    },
    focusSearch: () => searchRef.current?.focus(),
  });

  const selected = rows.filter((r) => sel.has(r.id));
  const extraParams: Record<string, string> = Object.fromEntries(
    [
      ["tab", view.tab],
      ["stage", view.stage],
      ["ch", view.channel],
      ["q", q],
      ["demo", searchParams.get("demo") ?? undefined],
    ].filter((e): e is [string, string] => Boolean(e[1])),
  );

  return (
    <div className="crm-page">
      <LeadsHeader ui={ui} q={qInput} onQ={onQ} searchRef={searchRef} />
      <PipelineStrip
        counts={counts.byStage}
        active={view.stage}
        ui={ui}
        wonLabel={wonLabel}
        onToggle={(s) => navigate({ tab: "all", stage: view.stage === s ? undefined : s, channel: view.channel, q: qInput })}
      />
      <ListBar
        tab={view.tab}
        channel={view.channel}
        counts={counts}
        ui={ui}
        onTab={(t) => navigate({ tab: t, channel: view.channel, q: qInput })}
        onChannel={(c) => navigate({ ...view, channel: c, q: qInput })}
      />
      <LeadsGrid
        rows={rows}
        tab={view.tab}
        busy={navPending}
        kbNav={kbNav}
        cursor={cursor}
        sel={sel}
        leaving={leaving}
        ui={ui}
        lang={lang}
        wonLabel={wonLabel}
        now={now}
        onPointer={() => setKbNav(false)}
        onOpen={openLead}
        onCheck={onCheck}
        onMenu={onMenu}
      />
      <p className="crm-keys">{ui.crm.keysHint}</p>
      {view.tab !== "needs" && total > 0 ? (
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/leads" ui={ui} extraParams={extraParams} />
      ) : null}
      {selected.length ? (
        <BulkBar
          count={selected.length}
          canSnooze={selected.some(isSnoozable)}
          ui={ui}
          onStage={(anchor) => setMenu({ kind: "stage", ids: selected.map((r) => r.id), anchor })}
          onSnooze={(anchor) => setMenu({ kind: "snooze", ids: selected.filter(isSnoozable).map((r) => r.id), anchor })}
          onRead={() => {
            markRead(selected.map((r) => r.id));
            setSel(new Set());
          }}
          onClear={() => setSel(new Set())}
        />
      ) : null}
      <ListMenus
        menu={menu}
        rows={rows}
        ui={ui}
        wonLabel={wonLabel}
        onClose={() => setMenu(null)}
        onStage={(ids, s, reason) => {
          setStage(ids, s, reason);
          if (ids.length > 1) setSel(new Set());
        }}
        onSnooze={(ids, days) => {
          snooze(ids, days);
          if (ids.length > 1) setSel(new Set());
        }}
        onNext={setNextStep}
      />
    </div>
  );
}
