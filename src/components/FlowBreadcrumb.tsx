import { stageLabel } from "@/lib/ui/labels";
import type { FlowDefinition } from "@/lib/flow/types";
import type { UiCopy } from "@/lib/ui";

const STAGE_ORDER = ["talk", "escalate", "done", "waiting_human"] as const;

export function FlowBreadcrumb({
  flow,
  current,
  ui,
}: {
  flow: FlowDefinition;
  current?: string;
  ui: UiCopy;
}) {
  const stages = STAGE_ORDER.filter((id) => id in flow.stages);
  if (!stages.length) return null;

  return (
    <div className="flow-breadcrumb" aria-label={ui.flow.progress}>
      {stages.map((id, i) => (
        <span key={id} className="flow-crumb-wrap">
          {i > 0 ? <span className="flow-crumb-sep" aria-hidden="true" /> : null}
          <span className={`flow-crumb${current === id ? " current" : ""}`}>
            {stageLabel(ui, id)}
          </span>
        </span>
      ))}
    </div>
  );
}
