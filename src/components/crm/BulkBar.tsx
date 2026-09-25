"use client";

import type { MouseEvent } from "react";
import { fillUi, type UiCopy } from "@/lib/ui";
import { Icon } from "./Icon";

/** Floating bar for the checked rows. Snooze is disabled when none of them can be snoozed. */
export function BulkBar({
  count,
  canSnooze,
  ui,
  onStage,
  onSnooze,
  onRead,
  onClear,
}: {
  count: number;
  canSnooze: boolean;
  ui: UiCopy;
  onStage: (anchor: HTMLElement) => void;
  onSnooze: (anchor: HTMLElement) => void;
  onRead: () => void;
  onClear: () => void;
}) {
  const at = (fn: (a: HTMLElement) => void) => (e: MouseEvent<HTMLButtonElement>) => fn(e.currentTarget);
  return (
    <div className="crm-bulk" role="toolbar" aria-label={fillUi(ui.crm.selected, { n: count })}>
      <span aria-live="polite">{fillUi(ui.crm.selected, { n: count })}</span>
      <button type="button" aria-haspopup="menu" onClick={at(onStage)}>
        {ui.crm.bulkStage}
      </button>
      <button type="button" aria-haspopup="menu" onClick={at(onSnooze)} disabled={!canSnooze}>
        {ui.crm.bulkSnooze}
      </button>
      <button type="button" onClick={onRead}>
        {ui.crm.bulkRead}
      </button>
      <button type="button" className="crm-bulk-x" onClick={onClear} aria-label={ui.crm.clearSelection} title={ui.crm.clearSelection}>
        <Icon name="x" />
      </button>
    </div>
  );
}
