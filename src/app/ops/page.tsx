import { FlowMap } from "@/components/FlowMap";
import { catalogMeta } from "@/lib/flow/catalog";
import { prisma } from "@/lib/db";
import type { FlowDefinition, HitlPolicy } from "@/lib/flow/types";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const tenantId = await requireTenantId();
  const agent = await prisma.agent.findFirst({ where: { tenantId } });
  if (!agent) return <p>No agent. Seed the DB.</p>;
  const flow = agent.flow as FlowDefinition;
  const hitl = agent.hitlPolicy as HitlPolicy;
  const stageIds = Object.keys(flow.stages);

  return (
    <div>
      <h1>Ops · {agent.name}</h1>
      <p className="muted">Version {agent.flowVersion}. Owners never see this page.</p>
      <div className="row">
        <div className="card">
          <h2>Flow</h2>
          <FlowMap flow={flow} />
        </div>
        <form action="/api/ops/agent" method="post" className="card stack">
          <input type="hidden" name="agentId" value={agent.id} />
          <fieldset>
            <legend>Catalog (re-clones the JSON flow)</legend>
            {catalogMeta.map((item) => (
              <label key={item.id} className="choice">
                <input
                  type="radio"
                  name="catalogId"
                  value={item.id}
                  defaultChecked={(agent.catalogId || "inbox") === item.id}
                />
                <span>
                  <strong>{item.title}</strong>
                  <span className="muted"> — {item.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            Knowledge (FAQ)
            <textarea name="knowledgeText" defaultValue={agent.knowledgeText} rows={5} />
          </label>
          <fieldset>
            <legend>After a conversation is done</legend>
            {(
              [
                ["ignore", "Ignore new messages"],
                ["restart", "Start the flow over"],
                ["fallback", "Switch to fallback stage"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name="restartPolicy"
                  value={value}
                  defaultChecked={flow.restartPolicy.onNewMessage === value}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label>
            Fallback stage
            <select
              name="fallbackStage"
              defaultValue={flow.restartPolicy.fallbackStage ?? ""}
            >
              <option value="">(none)</option>
              {stageIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Human-in-the-loop</legend>
            <label className="choice">
              <input
                type="checkbox"
                name="allowRequestHuman"
                defaultChecked={hitl.allowRequestHuman}
              />
              Allow request_human
            </label>
            <p className="muted">Stages allowed to escalate</p>
            {stageIds.map((id) => (
              <label key={id} className="choice">
                <input
                  type="checkbox"
                  name="allowedFromStages"
                  value={id}
                  defaultChecked={hitl.allowedFromStages.includes(id)}
                />
                {id}
              </label>
            ))}
            <p className="muted">Intents that may escalate</p>
            {["sales", "support", "other"].map((intent) => (
              <label key={intent} className="choice">
                <input
                  type="checkbox"
                  name="allowedIntents"
                  value={intent}
                  defaultChecked={hitl.allowedIntents?.includes(intent)}
                />
                {intent}
              </label>
            ))}
          </fieldset>
          <button type="submit">Save</button>
        </form>
      </div>
    </div>
  );
}
