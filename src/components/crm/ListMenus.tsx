"use client";

import type { LeadRowDTO } from "@/lib/crm/view";
import type { PipelineStage } from "@/lib/crm/types";
import type { UiCopy } from "@/lib/ui";
import type { SnoozeDays } from "./crm-client";
import type { RowMenu } from "./LeadRow";
import { NextStepMenu } from "./NextStepMenu";
import { SnoozeMenu } from "./SnoozeMenu";
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
  onSnooze,
  onNext,
}: {
  menu: OpenMenu | null;
  rows: LeadRowDTO[];
  ui: UiCopy;
  wonLabel: string;
  onClose: () => void;
  onStage: (ids: string[], stage: PipelineStage, reason: string) => void;
  onSnooze: (ids: string[], days: SnoozeDays) => void;
  onNext: (id: string, days: SnoozeDays, text: string) => void;
}) {
  if (!menu || !menu.ids.length) return null;
  const single = menu.ids.length === 1 ? rows.find((r) => r.id === menu.ids[0]) : undefined;
  const common = { anchor: menu.anchor, returnFocus: menu.returnFocus, ui, onClose };
  switch (menu.kind) {
    case "stage":
      return (
        <StageMenu {...common} current={single?.stage} wonLabel={wonLabel} onPick={(s, reason) => onStage(menu.ids, s, reason)} />
      );
    case "snooze":
      return <SnoozeMenu {...common} onPick={(d) => onSnooze(menu.ids, d)} />;
    case "next":
      return single ? (
        <NextStepMenu {...common} initialText={single.nextStepText ?? ""} onPick={(d, text) => onNext(single.id, d, text)} />
      ) : null;
  }
}
