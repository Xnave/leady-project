"use client";

import type { LeadRowDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { Icon, type IconName } from "./Icon";
import { Popover } from "./Popover";
import { isSnoozable } from "./rows";

export type RowSubmenu = "stage" | "next" | "snooze";

/**
 * Touch and narrow screens have no hover, so the row's icon buttons (and their tooltips)
 * are replaced by one "more" button. This menu lists every row action with an icon and a
 * text label; the ones that need a choice open their own menu in place.
 */
export function RowActionsMenu({
  anchor,
  returnFocus,
  row,
  ui,
  onClose,
  onToggleRead,
  onOpen,
  onSubmenu,
}: {
  anchor: HTMLElement;
  returnFocus?: HTMLElement | null;
  row: LeadRowDTO;
  ui: UiCopy;
  onClose: () => void;
  onToggleRead: (id: string, unread: boolean) => void;
  onOpen: (id: string) => void;
  onSubmenu: (kind: RowSubmenu) => void;
}) {
  const items: { key: string; icon: IconName; label: string; run: () => void }[] = [
    { key: "open", icon: "msg", label: ui.crm.openLead, run: () => onOpen(row.id) },
    {
      key: "read",
      icon: row.unread ? "mailOpen" : "mail",
      label: row.unread ? ui.inbox.markRead : ui.inbox.markUnread,
      run: () => onToggleRead(row.id, !row.unread),
    },
    { key: "next", icon: "calPlus", label: ui.crm.nextStep, run: () => onSubmenu("next") },
    ...(isSnoozable(row)
      ? [{ key: "snooze", icon: "clock" as IconName, label: ui.crm.snooze, run: () => onSubmenu("snooze") }]
      : []),
    { key: "stage", icon: "flag", label: ui.crm.changeStage, run: () => onSubmenu("stage") },
  ];
  return (
    <Popover anchor={anchor} returnFocus={returnFocus} label={ui.crm.moreActions} onClose={onClose}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="menuitem"
          className="crm-pop-item crm-pop-item-ic"
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          <Icon name={it.icon} small />
          {it.label}
        </button>
      ))}
    </Popover>
  );
}
