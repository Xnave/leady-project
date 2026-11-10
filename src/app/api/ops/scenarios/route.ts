import { NextResponse } from "next/server";
import { isProductionRuntime } from "@/lib/dev-auth-bypass";
import {
  decideScenarioRequest,
  endScenarioThread,
  purgeScenarioLeads,
  ScenarioHttpError,
  sendScenarioTurn,
} from "@/lib/scenarios/actions";
import {
  isScenarioSender,
  parseScenarioBefore,
  readScenarioEnv,
  scenarioAuthorized,
  scenarioTenantIds,
} from "@/lib/scenarios/guard";
import { loadScenarioSnapshot } from "@/lib/scenarios/snapshot";
import type { ScenarioCapability, ScenarioTarget } from "@/lib/scenarios/types";

export const maxDuration = 60;

type Body = {
  action?: string;
  target?: ScenarioTarget;
  capability?: ScenarioCapability;
  tenantId?: string;
  leadId?: string;
  text?: string;
  scenarioId?: string;
  runId?: string;
  requestId?: string;
  decision?: "approve" | "decline" | "reschedule";
  alternativeStart?: string;
  alternativeEnd?: string;
  /** `YYYY-MM-DD`. Purge deletes scenario leads created before local midnight of this day. */
  before?: string;
};

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const env = readScenarioEnv(
    {
      SCENARIO_RUNNER_SECRET: process.env["SCENARIO_RUNNER_SECRET"],
      SCENARIO_BOOKING_TENANT_ID: process.env["SCENARIO_BOOKING_TENANT_ID"],
      SCENARIO_RESERVATION_TENANT_ID: process.env["SCENARIO_RESERVATION_TENANT_ID"],
      SCENARIO_RESERVATION_LINK_TENANT_ID: process.env["SCENARIO_RESERVATION_LINK_TENANT_ID"],
      SCENARIO_CANARY_BOOKING_TENANT_ID: process.env["SCENARIO_CANARY_BOOKING_TENANT_ID"],
      SCENARIO_CANARY_RESERVATION_TENANT_ID: process.env["SCENARIO_CANARY_RESERVATION_TENANT_ID"],
      SCENARIO_TENANT_ALLOWLIST: process.env["SCENARIO_TENANT_ALLOWLIST"],
      DEV_TENANT_ID: process.env["DEV_TENANT_ID"],
    },
    isProductionRuntime(),
  );
  if (!scenarioAuthorized(req.headers.get("authorization"), env.secret)) {
    return jsonError(401, "unauthorized");
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action) return jsonError(400, "bad_request");
  const target = body.target ?? "local";
  if (target !== "local" && target !== "canary" && target !== "live") {
    return jsonError(400, "bad_target");
  }
  if (body.capability && body.capability !== "booking" && body.capability !== "reservations") {
    return jsonError(400, "bad_capability");
  }

  const needsCapability = body.action === "send" || body.action === "snapshot" || body.action === "decide" || body.action === "end";
  if (needsCapability && !body.capability) return jsonError(400, "capability_required");

  const resolved = scenarioTenantIds(env, {
    target,
    capability: body.action === "purge" ? undefined : body.capability,
    tenantId: body.action === "purge" ? (target === "live" ? body.tenantId : undefined) : body.tenantId,
  });
  if (!resolved.ok) return jsonError(resolved.status, resolved.error);
  const tenantId = body.tenantId && resolved.tenantIds.includes(body.tenantId) ? body.tenantId : resolved.tenantIds[0];
  if (!tenantId && body.action !== "purge") return jsonError(503, "missing_tenant");

  try {
    if (body.action === "send") {
      if (!tenantId) return jsonError(503, "missing_tenant");
      const result = await sendScenarioTurn({
        tenantId,
        text: body.text ?? "",
        leadId: body.leadId,
        scenarioId: body.scenarioId,
        runId: body.runId,
      });
      return NextResponse.json({ ok: true, answered: result.answered, snapshot: result.snapshot });
    }
    if (body.action === "snapshot") {
      if (!tenantId || !body.leadId) return jsonError(400, "lead_required");
      const snapshot = await loadScenarioSnapshot(tenantId, body.leadId);
      if (!snapshot) return jsonError(404, "not_found");
      if (!isScenarioSender(snapshot.externalUserId)) return jsonError(403, "not_scenario_lead");
      return NextResponse.json({ ok: true, snapshot });
    }
    if (body.action === "decide") {
      if (!tenantId || !body.requestId) return jsonError(400, "request_required");
      if (body.decision !== "approve" && body.decision !== "decline" && body.decision !== "reschedule") {
        return jsonError(400, "bad_decision");
      }
      const alternativeStart = body.alternativeStart?.trim() ?? "";
      const alternativeEnd = body.alternativeEnd?.trim() ?? "";
      if (body.decision === "reschedule" && !alternativeStart) {
        return jsonError(400, "alternative_required");
      }
      const snapshot = await decideScenarioRequest({
        tenantId,
        requestId: body.requestId,
        decision: body.decision,
        alternativeStart: alternativeStart || undefined,
        alternativeEnd: alternativeEnd || undefined,
      });
      return NextResponse.json({ ok: true, snapshot });
    }
    if (body.action === "end") {
      if (!tenantId || !body.leadId) return jsonError(400, "lead_required");
      const snapshot = await endScenarioThread(tenantId, body.leadId);
      return NextResponse.json({ ok: true, snapshot });
    }
    if (body.action === "purge") {
      const before = body.before ? parseScenarioBefore(body.before) ?? undefined : undefined;
      if (body.before && !before) return jsonError(400, "bad_before");
      const result = await purgeScenarioLeads(resolved.tenantIds, { leadId: body.leadId, before });
      return NextResponse.json({ ok: true, ...result });
    }
    return jsonError(400, "bad_action");
  } catch (error) {
    if (error instanceof ScenarioHttpError) return jsonError(error.status, error.message);
    console.error(error);
    return jsonError(500, "failed");
  }
}
