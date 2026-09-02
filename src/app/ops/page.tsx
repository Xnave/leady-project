import { FlowMap } from "@/components/FlowMap";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import type { FlowDefinition, HitlPolicy } from "@/lib/flow/types";
import { getUiLang } from "@/lib/cookies";
import { requireTenantId } from "@/lib/tenant";
import { intentLabel, stageLabel } from "@/lib/ui/labels";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const agent = await prisma.agent.findFirst({ where: { tenantId } });
  if (!agent) return <p className="empty-state">{ui.errors.noAgent}</p>;
  const flow = agent.flow as FlowDefinition;
  const hitl = agent.hitlPolicy as HitlPolicy;
  const stageIds = Object.keys(flow.stages);

  const restartOptions = [
    ["ignore", ui.ops.ignoreMessages],
    ["restart", ui.ops.restartFlow],
    ["fallback", ui.ops.fallbackStage],
  ] as const;

  return (
    <div>
      <PageHeader
        title={`${ui.page.opsTitle} · ${agent.name}`}
        blurb={`${ui.common.version} ${agent.flowVersion}`}
      />
      <p className="muted">{ui.ops.ownersNeverSee}</p>
      <div className="row">
        <div className="card">
          <h2>{ui.common.flow}</h2>
          <FlowMap flow={flow} labels={ui.flow} ui={ui} />
        </div>
        <form action="/api/ops/agent" method="post" className="card stack">
          <input type="hidden" name="agentId" value={agent.id} />
          <fieldset>
            <legend>{ui.ops.catalogLegend}</legend>
            <div className="radio-card-grid">
              {(["inbox", "book", "faq"] as const).map((id) => (
                <label
                  key={id}
                  className={`radio-card${(agent.catalogId || "inbox") === id ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="catalogId"
                    value={id}
                    defaultChecked={(agent.catalogId || "inbox") === id}
                  />
                  <div className="radio-card-body">
                    <strong>{ui.catalog[id].title}</strong>
                    <span className="muted">{ui.catalog[id].blurb}</span>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            {ui.common.knowledge}
            <textarea name="knowledgeText" defaultValue={agent.knowledgeText} rows={5} />
          </label>
          <fieldset>
            <legend>{ui.ops.afterDoneLegend}</legend>
            <div className="radio-card-grid compact">
              {restartOptions.map(([value, label]) => (
                <label
                  key={value}
                  className={`radio-card${flow.restartPolicy.onNewMessage === value ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="restartPolicy"
                    value={value}
                    defaultChecked={flow.restartPolicy.onNewMessage === value}
                  />
                  <div className="radio-card-body">
                    <strong>{label}</strong>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            {ui.ops.fallbackStageLabel}
            <select name="fallbackStage" defaultValue={flow.restartPolicy.fallbackStage ?? ""}>
              <option value="">{ui.ops.noneOption}</option>
              {stageIds.map((id) => (
                <option key={id} value={id}>
                  {stageLabel(ui, id)}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>{ui.ops.hitlLegend}</legend>
            <label className="choice">
              <input
                type="checkbox"
                name="allowRequestHuman"
                defaultChecked={hitl.allowRequestHuman}
              />
              {ui.ops.allowHuman}
            </label>
            <p className="muted">{ui.ops.stagesLegend}</p>
            {stageIds.map((id) => (
              <label key={id} className="choice">
                <input
                  type="checkbox"
                  name="allowedFromStages"
                  value={id}
                  defaultChecked={hitl.allowedFromStages.includes(id)}
                />
                {stageLabel(ui, id)}
              </label>
            ))}
            <p className="muted">{ui.ops.intentsLegend}</p>
            {["sales", "support", "other"].map((intent) => (
              <label key={intent} className="choice">
                <input
                  type="checkbox"
                  name="allowedIntents"
                  value={intent}
                  defaultChecked={hitl.allowedIntents?.includes(intent)}
                />
                {intentLabel(ui, intent)}
              </label>
            ))}
          </fieldset>
          <button type="submit">{ui.common.save}</button>
        </form>
      </div>
    </div>
  );
}
