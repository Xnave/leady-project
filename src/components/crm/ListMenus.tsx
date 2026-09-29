"use client";

import type { LeadRowDTO } from "@/lib/crm/view";
import type { PipelineStage } from "@/lib/crm/types";
import type { UiCopy } from "@/lib/ui";
import type { RowMenu } from "./LeadRow";
import { NextStepMenu } from "./NextStepMenu";
import { RowActionsMenu, type RowSubmenu } from "./RowActionsMenu";
import { StageMenu } from "./StageMenu";

export type OpenMenu = { kind: RowMenu; ids: string[]; anchor: HTMLElement; returnFocus?: HTMLElement | null };

/** Whichever row or bulk popover is open (at most one). */
export function ListMenus({
  menu,
  rows,
  ui,
  wonLabel,
  onClose,
  onStage,
  onNext,
  onToggleRead,
  onOpen,
  onSubmenu,
}: {
  menu: OpenMenu | null;
  rows: LeadRowDTO[];
  ui: UiCopy;
  wonLabel: string;
  onClose: () => void;
  onStage: (ids: string[], stage: PipelineStage, reason: string) => void;
  onNext: (id: string, at: string, text: string) => void;
  onToggleRead: (id: string, unread: boolean) => void;
  onOpen: (id: string) => void;
  /** From the mobile actions menu: reopen the same anchor with a choice menu. */
  onSubmenu: (kind: RowSubmenu, menu: OpenMenu) => void;
}) {
  if (!menu || !menu.ids.length) return null;
  const single = menu.ids.length === 1 ? rows.find((r) => r.id === menu.ids[0]) : undefined;
  const common = { anchor: menu.anchor, returnFocus: menu.returnFocus, ui, onClose };
  switch (menu.kind) {
    case "stage":
      return (
        <StageMenu {...common} current={single?.stage} wonLabel={wonLabel} onPick={(s, reason) => onStage(menu.ids, s, reason)} />
      );
    case "actions":
      return single ? (
        <RowActionsMenu
          {...common}
          row={single}
          onToggleRead={onToggleRead}
          onOpen={onOpen}
          onSubmenu={(kind) => onSubmenu(kind, menu)}
        />
      ) : null;
    case "next":
      return single ? (
        <NextStepMenu {...common} initialText={single.nextStepText ?? ""} onPick={(at, text) => onNext(single.id, at, text)} />
      ) : null;
  }
}
