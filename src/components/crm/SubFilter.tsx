"use client";

import type { CrmCounts, CrmTab } from "@/lib/crm/view";
import { ACTIVE_STAGES, CLOSED_STAGES, NEEDS_REASONS, PIPELINE_STAGES, type FollowUpReason, type PipelineStage } from "@/lib/crm/types";
import type { UiCopy } from "@/lib/ui";
import { Icon } from "./Icon";
import { FU_ICON } from "./LeadRow";
import { stageLabel } from "./StageMenu";

type Option = { key: string; label: string; n: number; pressed: boolean; mark: "stage" | "reason"; value: string };

/**
 * The second filter level: it narrows the selected tab. Needs you → why (reason);
 * Gone cold has one reason, so no row;
 * Active → pipeline stage (with counts, the pipeline at a glance); Lost / not
 * relevant → which of the two; All → any stage. Won has a single stage, so no row.
 */
export function SubFilter({
  tab,
  stage,
  reason,
  counts,
  ui,
  wonLabel,
  onStage,
  onReason,
}: {
  tab: CrmTab;
  stage?: PipelineStage;
  reason?: FollowUpReason;
  counts: CrmCounts;
  ui: UiCopy;
  wonLabel: string;
  onStage: (s: PipelineStage | undefined) => void;
  onReason: (r: FollowUpReason | undefined) => void;
}) {
  const stages: readonly PipelineStage[] | null =
    tab === "active" ? ACTIVE_STAGES : tab === "closed" ? CLOSED_STAGES : tab === "all" ? PIPELINE_STAGES : null;
  const options: Option[] =
    tab === "needs"
      ? NEEDS_REASONS.map((r) => ({
          key: r,
          label: ui.crm.reasons[r],
          n: counts.byReason[r],
          pressed: reason === r,
          mark: "reason" as const,
          value: r,
        }))
      : (stages ?? [])
          // `link_sent` only exists for tenants that send booking links: hide it until used.
          .filter((st) => st !== "link_sent" || counts.byStage[st] > 0 || stage === st)
          .map((st) => ({
          key: st,
          label: stageLabel(ui, wonLabel, st),
          n: counts.byStage[st],
          pressed: stage === st,
          mark: "stage" as const,
          value: st,
        }));
  if (!options.length) return null;

  const none = tab === "needs" ? !reason : !stage;
  const pick = (o: Option | null) => {
    if (tab === "needs") onReason(o && !o.pressed ? (o.value as FollowUpReason) : undefined);
    else onStage(o && !o.pressed ? (o.value as PipelineStage) : undefined);
  };

  return (
    <div className="crm-subbar" role="group" aria-label={ui.crm.tabs[tab]}>
      <button type="button" className="crm-fchip" aria-pressed={none} onClick={() => pick(null)}>
        {ui.common.all}
      </button>
      {options.map((o) => (
        <button key={o.key} type="button" className="crm-fchip" aria-pressed={o.pressed} onClick={() => pick(o)}>
          {o.mark === "stage" ? (
            <span className={`crm-dot-only crm-s-${o.value}`} aria-hidden="true">
              <span className="crm-sdot" />
            </span>
          ) : (
            <Icon name={FU_ICON[o.value as FollowUpReason]} small />
          )}
          {o.label}
          <span className="crm-fchip-n">{o.n}</span>
        </button>
      ))}
    </div>
  );
}
