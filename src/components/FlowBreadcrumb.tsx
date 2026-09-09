import { stageLabel } from "@/lib/ui/labels";
import type { FlowDefinition } from "@/lib/flow/types";
import type { UiCopy } from "@/lib/ui";

export function flowDisplayOrder(flow: FlowDefinition): string[] {
  if (flow.displayOrder?.length) {
    return flow.displayOrder.filter((id) => id in flow.stages);
  }
  const preferred = ["talk", "escalate", "waiting_human", "done"];
  const ordered = preferred.filter((id) => id in flow.stages);
  for (const id of Object.keys(flow.stages)) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function FlowBreadcrumb({
  flow,
  current,
  ui,
}: {
  flow: FlowDefinition;
  current?: string;
  ui: UiCopy;
}) {
  const stages = flowDisplayOrder(flow);
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
