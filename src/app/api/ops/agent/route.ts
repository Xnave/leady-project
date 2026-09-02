import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { flowForCatalog, isCatalogId, type CatalogId } from "@/lib/flow/catalog";
import { validateFlow } from "@/lib/flow/validate";
import { bookingCollectFromFlow } from "@/lib/flow/booking-collect";
import type { FlowDefinition, HitlPolicy, LeadSchema } from "@/lib/flow/types";
import { FlowConfigError } from "@/lib/flow/types";
import { redirectPath } from "@/lib/request-url";

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  const form = await req.formData();
  const agentId = String(form.get("agentId"));
  const agent = await prisma.agent.findFirstOrThrow({
    where: { id: agentId, tenantId },
  });
  const catalogRaw = String(form.get("catalogId") || agent.catalogId || "inbox");
  const catalogId: CatalogId = isCatalogId(catalogRaw) ? catalogRaw : "inbox";
  const flow = flowForCatalog(
    catalogId,
    bookingCollectFromFlow(agent.flow as FlowDefinition),
  );
  flow.restartPolicy = {
    onNewMessage: String(form.get("restartPolicy") ?? "fallback") as
      | "ignore"
      | "restart"
      | "fallback",
    fallbackStage: String(form.get("fallbackStage") || "") || undefined,
  };
  const hitlPolicy: HitlPolicy = {
    allowRequestHuman: form.get("allowRequestHuman") === "on",
    allowedFromStages: form.getAll("allowedFromStages").map(String),
    allowedIntents: form.getAll("allowedIntents").map(String),
    minConfidence: Number(form.get("minConfidence") || 0.4),
  };
  const leadSchema = agent.leadSchema as LeadSchema;
  const knowledgeText = String(form.get("knowledgeText") ?? "");

  try {
    validateFlow(flow, leadSchema, hitlPolicy);
  } catch (e) {
    const msg = e instanceof FlowConfigError ? e.errors.join("\n") : String(e);
    return new NextResponse(msg, { status: 400 });
  }

  const nextVersion = agent.flowVersion + 1;
  await prisma.$transaction([
    prisma.agentConfigRevision.create({
      data: {
        tenantId,
        agentId,
        kind: "flow",
        version: nextVersion,
        payload: { catalogId, flow },
      },
    }),
    prisma.agent.update({
      where: { id: agentId },
      data: {
        catalogId,
        flow,
        flowVersion: nextVersion,
        flowChangedAt: new Date(),
        hitlPolicy,
        knowledgeText,
      },
    }),
  ]);

  return NextResponse.redirect(redirectPath(req, "/ops"), 303);
}
