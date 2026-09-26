"use client";

import { useState } from "react";
import type { LeadViewDTO } from "@/lib/crm/view";
import { isClosedStage, RANKED_STAGES, stageRank, type PipelineStage } from "@/lib/crm/types";
import type { UiCopy } from "@/lib/ui";
import { Icon } from "./Icon";
import { autoReasonKey, manualStageActor } from "./lead-view";
import { StageMenu, stageLabel } from "./StageMenu";

/** "Auto · bot is talking" or "Manual · Snir · Price". */
export function stageWhy(dto: Pick<LeadViewDTO, "stage" | "stageSource" | "stageReason" | "timeline">, ui: UiCopy): string {
  if (dto.stageSource === "manual") {
    return [ui.crm.manual, manualStageActor(dto), dto.stageReason.trim()].filter(Boolean).join(" · ");
  }
  const key = autoReasonKey(dto.stageReason);
  const why = key ? ui.crm.autoReasons[key] : "";
  return why ? `${ui.crm.auto} · ${why}` : ui.crm.auto;
}

/**
 * Five points for the open pipeline. A closed lead (lost / not relevant) shows every
 * point dashed and none current; its stage is on the chip below. The chip opens the
 * same `StageMenu` as the list.
 */
export function StageStepper({
  dto,
  ui,
  wonLabel,
  onPick,
}: {
  dto: LeadViewDTO;
  ui: UiCopy;
  wonLabel: string;
  onPick: (stage: PipelineStage, reason: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const closed = isClosedStage(dto.stage);
  const cur = stageRank(dto.stage);
  const label = stageLabel(ui, wonLabel, dto.stage);

  return (
    <div className="crm-stepper">
      <div className={closed ? "crm-steps closed" : "crm-steps"} aria-hidden="true">
        {RANKED_STAGES.map((s, i) => {
          const cls = closed ? "" : i < cur ? " done" : i === cur ? " cur" : "";
          return (
            <span key={s} className={`crm-st${cls}`}>
              <span className="crm-st-pt" />
              {i < RANKED_STAGES.length - 1 ? <span className="crm-st-ln" /> : null}
            </span>
          );
        })}
      </div>
      <div className="crm-step-labels" aria-hidden="true">
        {RANKED_STAGES.map((s) => (
          <span key={s} className={s === dto.stage ? "cur" : undefined}>
            {stageLabel(ui, wonLabel, s)}
          </span>
        ))}
      </div>
      <div className="crm-stage-row">
        <button
          type="button"
          className={`crm-stage crm-s-${dto.stage}`}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          aria-label={`${ui.crm.cols.stage}: ${label}`}
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        >
          <span className="crm-sdot" />
          {label}
          <Icon name="down" small />
        </button>
        <span className="crm-src">{stageWhy(dto, ui)}</span>
      </div>
      {anchor ? (
        <StageMenu
          anchor={anchor}
          current={dto.stage}
          ui={ui}
          wonLabel={wonLabel}
          onPick={onPick}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </div>
  );
}
