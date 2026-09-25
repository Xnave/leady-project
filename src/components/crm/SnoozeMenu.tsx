"use client";

import type { UiCopy } from "@/lib/ui";
import type { SnoozeDays } from "./crm-client";
import { Popover } from "./Popover";

export function snoozeLabel(ui: UiCopy, d: SnoozeDays): string {
  return d === 1 ? ui.crm.snooze1 : d === 3 ? ui.crm.snooze3 : ui.crm.snooze7;
}

export function SnoozeMenu({
  anchor,
  returnFocus,
  ui,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  returnFocus?: HTMLElement | null;
  ui: UiCopy;
  onPick: (days: SnoozeDays) => void;
  onClose: () => void;
}) {
  return (
    <Popover anchor={anchor} returnFocus={returnFocus} label={ui.crm.snooze} onClose={onClose}>
      <h6>{ui.crm.snooze}</h6>
      {([1, 3, 7] as const).map((d) => (
        <button
          key={d}
          type="button"
          role="menuitem"
          className="crm-pop-item"
          onClick={() => {
            onClose();
            onPick(d);
          }}
        >
          {snoozeLabel(ui, d)}
        </button>
      ))}
    </Popover>
  );
}
