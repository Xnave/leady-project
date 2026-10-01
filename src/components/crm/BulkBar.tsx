"use client";

import type { MouseEvent } from "react";
import { fillUi, type UiCopy } from "@/lib/ui";
import { Icon } from "./Icon";

/** Floating bar for the checked rows. */
export function BulkBar({
  count,
  ui,
  onStage,
  onRead,
  onUnread,
  onClear,
}: {
  count: number;
  ui: UiCopy;
  onStage: (anchor: HTMLElement) => void;
  onRead: () => void;
  onUnread: () => void;
  onClear: () => void;
}) {
  const at = (fn: (a: HTMLElement) => void) => (e: MouseEvent<HTMLButtonElement>) => fn(e.currentTarget);
  return (
    <div className="crm-bulk" role="toolbar" aria-label={fillUi(ui.crm.selected, { n: count })}>
      <span aria-live="polite">{fillUi(ui.crm.selected, { n: count })}</span>
      <button type="button" aria-haspopup="menu" onClick={at(onStage)}>
        {ui.crm.bulkStage}
      </button>
      <button type="button" onClick={onRead}>
        {ui.crm.bulkRead}
      </button>
      <button type="button" onClick={onUnread}>
        {ui.crm.bulkUnread}
      </button>
      <button type="button" className="crm-bulk-x" onClick={onClear} aria-label={ui.crm.clearSelection} title={ui.crm.clearSelection}>
        <Icon name="x" />
      </button>
    </div>
  );
}
