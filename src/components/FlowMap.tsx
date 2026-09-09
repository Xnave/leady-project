import { flowDisplayOrder } from "@/components/FlowBreadcrumb";
import { stageTargets } from "@/lib/flow/validate";
import type { FlowDefinition } from "@/lib/flow/types";
import {
  actionLabel,
  intentLabel,
  restartPolicyLabel,
  stageLabel,
  stageTypeLabel,
} from "@/lib/ui/labels";
import type { UiCopy } from "@/lib/ui";

type Labels = {
  start: string;
  afterDone: string;
  needFields: string;
  transitions: string;
};

export function FlowMap({
  flow,
  current,
  labels,
  ui,
}: {
  flow: FlowDefinition;
  current?: string;
  labels?: Labels;
  ui: UiCopy;
}) {
  const L = labels ?? ui.flow;
  const stageIds = flowDisplayOrder(flow);

  return (
    <div className="flow-map">
      <p className="muted">
        {L.start}: <strong>{stageLabel(ui, flow.start)}</strong> · {L.afterDone}:{" "}
        <strong>{restartPolicyLabel(ui, flow.restartPolicy.onNewMessage)}</strong>
        {flow.restartPolicy.fallbackStage ? (
          <>
            {" "}
            <span className="flow-arrow" aria-hidden="true">
              →
            </span>{" "}
            {stageLabel(ui, flow.restartPolicy.fallbackStage)}
          </>
        ) : (
          ""
        )}
      </p>
      {stageIds.map((id) => {
        const stage = flow.stages[id];
        const next = stageTargets(stage);
        return (
          <div key={id} className={`stage-node${current === id ? " current" : ""}`}>
            <div>
              <span className="badge">{stageTypeLabel(ui, stage.type)}</span>
              <strong> {stageLabel(ui, id)}</strong>
            </div>
            {stage.type === "collect" ? (
              <p className="muted">
                {L.needFields}: {stage.required_fields.join(", ")}
              </p>
            ) : null}
            {stage.type === "classify" ? (
              <p className="muted">
                {Object.entries(stage.transitions).map(([intent, to], i) => (
                  <span key={intent}>
                    {i > 0 ? " · " : null}
                    {intentLabel(ui, intent)}{" "}
                    <span className="flow-arrow" aria-hidden="true">
                      →
                    </span>{" "}
                    {stageLabel(ui, to)}
                  </span>
                ))}
              </p>
            ) : null}
            {stage.type === "action" ? (
              <p className="muted">{actionLabel(ui, stage.action)}</p>
            ) : null}
            {next.length > 0 && stage.type !== "classify" ? (
              <p className="muted">
                <span className="flow-arrow" aria-hidden="true">
                  →
                </span>{" "}
                {next.map((n) => stageLabel(ui, n)).join(", ")}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
