"use client";

import { useState } from "react";
import { CLOSED_STAGES, RANKED_STAGES, type PipelineStage } from "@/lib/crm/types";
import type { UiCopy } from "@/lib/ui";
import { Popover } from "./Popover";

export function stageLabel(ui: UiCopy, wonLabel: string, stage: PipelineStage): string {
  return stage === "won" ? wonLabel : ui.crm.stages[stage];
}

function Dot({ stage }: { stage: PipelineStage }) {
  return (
    <span className={`crm-dot-only crm-s-${stage}`} aria-hidden="true">
      <span className="crm-sdot" />
    </span>
  );
}

/**
 * Stage picker. Lost / not relevant open a second step with the tenant-neutral reason
 * list; picking a reason is optional (the last item saves without one).
 */
export function StageMenu({
  anchor,
  returnFocus,
  current,
  ui,
  wonLabel,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  returnFocus?: HTMLElement | null;
  current?: PipelineStage;
  ui: UiCopy;
  wonLabel: string;
  onPick: (stage: PipelineStage, reason: string) => void;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState<PipelineStage | null>(null);
  const label = (s: PipelineStage) => stageLabel(ui, wonLabel, s);
  const pick = (s: PipelineStage, reason = "") => {
    onClose();
    if (s !== current || reason) onPick(s, reason);
  };

  const item = (s: PipelineStage) => (
    <button
      key={s}
      type="button"
      role="menuitemradio"
      aria-checked={s === current}
      className="crm-pop-item"
      onClick={() => ((CLOSED_STAGES as readonly string[]).includes(s) ? setClosing(s) : pick(s))}
    >
      <Dot stage={s} />
      {label(s)}
    </button>
  );

  // One Popover for both steps, so focus and position carry over instead of remounting.
  return (
    <Popover
      anchor={anchor}
      returnFocus={returnFocus}
      label={closing ? ui.crm.reasonPrompt : ui.crm.cols.stage}
      onClose={onClose}
    >
      {closing ? (
        <>
          <h6>{ui.crm.reasonPrompt}</h6>
          {(closing === "lost" ? ui.crm.lostReasons : ui.crm.notRelevantReasons).map((r, i) => (
            <button
              key={r}
              type="button"
              role="menuitem"
              className="crm-pop-item"
              autoFocus={i === 0}
              onClick={() => pick(closing, r)}
            >
              {r}
            </button>
          ))}
          <hr />
          <button type="button" role="menuitem" className="crm-pop-item" onClick={() => pick(closing)}>
            <Dot stage={closing} />
            {label(closing)}
          </button>
        </>
      ) : (
        <>
          <h6>{ui.crm.cols.stage}</h6>
          {RANKED_STAGES.map(item)}
          <hr />
          {CLOSED_STAGES.map(item)}
        </>
      )}
    </Popover>
  );
}
