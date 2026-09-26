"use client";

import type { CrmTab, LeadRowDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import type { Clock } from "./format";
import { Icon } from "./Icon";
import { LeadRow, type RowMenu } from "./LeadRow";

/** The `role="grid"` list: header row, lead rows, or the tab's empty state. */
export function LeadsGrid({
  rows,
  tab,
  busy,
  kbNav,
  cursor,
  sel,
  leaving,
  ui,
  lang,
  wonLabel,
  clock,
  onPointer,
  onOpen,
  onCheck,
  onMenu,
}: {
  rows: LeadRowDTO[];
  tab: CrmTab;
  busy: boolean;
  kbNav: boolean;
  cursor: number;
  sel: ReadonlySet<string>;
  leaving: ReadonlySet<string>;
  ui: UiCopy;
  lang: "he" | "en";
  wonLabel: string;
  clock: Clock;
  onPointer: () => void;
  onOpen: (id: string) => void;
  onCheck: (id: string, on: boolean) => void;
  onMenu: (kind: RowMenu, id: string, anchor: HTMLElement) => void;
}) {
  const c = ui.crm.cols;
  return (
    <div
      id="crm-leads-grid"
      className={kbNav ? "crm-list kbnav" : "crm-list"}
      role="grid"
      aria-label={ui.page.leadsTitle}
      aria-busy={busy}
      aria-rowcount={rows.length + 1}
      onPointerMove={kbNav ? onPointer : undefined}
    >
      <div className="crm-lhead" role="row">
        <span role="columnheader" />
        <span role="columnheader">{c.lead}</span>
        <span role="columnheader">{c.stage}</span>
        <span role="columnheader">{c.stand}</span>
        <span role="columnheader">{c.followUp}</span>
        <span role="columnheader">{c.last}</span>
        <span role="columnheader" />
      </div>
      {rows.length ? (
        rows.map((r, i) => (
          <LeadRow
            key={r.id}
            row={r}
            kb={i === cursor}
            checked={sel.has(r.id)}
            leaving={leaving.has(r.id)}
            ui={ui}
            lang={lang}
            wonLabel={wonLabel}
            clock={clock}
            onOpen={onOpen}
            onCheck={onCheck}
            onMenu={onMenu}
          />
        ))
      ) : (
        <div role="row">
          <div className="crm-empty" role="gridcell">
            {tab === "needs" ? (
              <>
                <span className="crm-empty-icon" aria-hidden="true">
                  <Icon name="check" />
                </span>
                <strong>{ui.crm.needsEmptyTitle}</strong>
                <span>{ui.crm.needsEmpty}</span>
              </>
            ) : (
              <>
                <strong>{ui.crm.emptyTitle}</strong>
                <span>{ui.crm.empty}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
