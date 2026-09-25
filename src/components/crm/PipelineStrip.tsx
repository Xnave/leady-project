"use client";

import type { CrmCounts } from "@/lib/crm/view";
import { RANKED_STAGES, type PipelineStage } from "@/lib/crm/types";
import type { UiCopy } from "@/lib/ui";
import { stageLabel } from "./StageMenu";

/** Five open-pipeline cells. Won counts the last 30 days. Clicking a cell toggles the stage filter. */
export function PipelineStrip({
  counts,
  active,
  onToggle,
  ui,
  wonLabel,
}: {
  counts: CrmCounts["byStage"];
  active?: PipelineStage;
  onToggle: (stage: PipelineStage) => void;
  ui: UiCopy;
  wonLabel: string;
}) {
  const n = (s: (typeof RANKED_STAGES)[number]) => (s === "won" ? counts.won30 : counts[s]);
  const max = Math.max(1, ...RANKED_STAGES.map(n));
  return (
    <div className="crm-pipe" role="group" aria-label={ui.crm.cols.stage}>
      {RANKED_STAGES.map((s) => (
        <button
          key={s}
          type="button"
          className="crm-pipe-cell"
          data-stage={s}
          aria-pressed={active === s}
          onClick={() => onToggle(s)}
        >
          <span className="crm-pipe-label">
            <span className={`crm-dot-only crm-s-${s}`} aria-hidden="true">
              <span className="crm-sdot" />
            </span>
            {stageLabel(ui, wonLabel, s)}
          </span>
          <span className="crm-pipe-n">
            {n(s)}
            {s === "won" ? <small>{ui.crm.wonWindow}</small> : null}
          </span>
          <span className="crm-pipe-bar" aria-hidden="true">
            <span style={{ inlineSize: `${(n(s) / max) * 100}%` }} />
          </span>
        </button>
      ))}
    </div>
  );
}
