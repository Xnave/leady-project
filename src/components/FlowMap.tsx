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

  return (
    <div className="flow-map">
      <p className="muted">
        {L.start}: <strong>{stageLabel(ui, flow.start)}</strong> · {L.afterDone}:{" "}
        <strong>{restartPolicyLabel(ui, flow.restartPolicy.onNewMessage)}</strong>
        {flow.restartPolicy.fallbackStage
          ? ` → ${stageLabel(ui, flow.restartPolicy.fallbackStage)}`
          : ""}
      </p>
      {Object.entries(flow.stages).map(([id, stage]) => {
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
                {Object.entries(stage.transitions)
                  .map(
                    ([intent, to]) =>
                      `${intentLabel(ui, intent)} → ${stageLabel(ui, to)}`,
                  )
                  .join(" · ")}
              </p>
            ) : null}
            {stage.type === "action" ? (
              <p className="muted">{actionLabel(ui, stage.action)}</p>
            ) : null}
            {next.length > 0 && stage.type !== "classify" ? (
              <p className="muted">
                → {next.map((n) => stageLabel(ui, n)).join(", ")}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
