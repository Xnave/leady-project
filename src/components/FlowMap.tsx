import { stageTargets } from "@/lib/flow/validate";
import type { FlowDefinition } from "@/lib/flow/types";

export function FlowMap({
  flow,
  current,
}: {
  flow: FlowDefinition;
  current?: string;
}) {
  return (
    <div className="flow-map">
      <p className="muted">
        Start: <strong>{flow.start}</strong> · After done:{" "}
        <strong>{flow.restartPolicy.onNewMessage}</strong>
        {flow.restartPolicy.fallbackStage
          ? ` → ${flow.restartPolicy.fallbackStage}`
          : ""}
      </p>
      {Object.entries(flow.stages).map(([id, stage]) => {
        const next = stageTargets(stage);
        return (
          <div
            key={id}
            className={`stage-node${current === id ? " current" : ""}`}
          >
            <div>
              <span className="badge">{stage.type}</span>
              <strong> {id}</strong>
            </div>
            {stage.type === "collect" ? (
              <p className="muted">Need: {stage.required_fields.join(", ")}</p>
            ) : null}
            {stage.type === "classify" ? (
              <p className="muted">
                {Object.entries(stage.transitions)
                  .map(([intent, to]) => `${intent} → ${to}`)
                  .join(" · ")}
              </p>
            ) : null}
            {stage.type === "talk" ? (
              <p className="muted">{stage.prompt.slice(0, 120)}</p>
            ) : null}
            {stage.type === "action" ? (
              <p className="muted">{stage.action}</p>
            ) : null}
            {next.length > 0 && stage.type !== "classify" ? (
              <p className="muted">→ {next.join(", ")}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
