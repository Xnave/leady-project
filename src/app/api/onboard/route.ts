import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildAgentSystemPrompt,
  flowForCatalog,
  hitlForCatalog,
  isCatalogId,
  type CatalogId,
} from "@/lib/flow/catalog";
import { isChatLanguage, type ChatLanguage } from "@/lib/flow/locale";
import { defaultLeadSchema, validateFlow } from "@/lib/flow/validate";
import { FlowConfigError } from "@/lib/flow/types";
import { requireTenantId } from "@/lib/tenant";

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  const body = (await req.json()) as {
    name?: string;
    phone?: string;
    intro?: string;
    knowledgeText?: string;
    catalogId?: string;
    chatLanguage?: string;
    idleResetDays?: number;
  };

  const name = String(body.name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const intro = String(body.intro ?? "").trim();
  const knowledgeText = String(body.knowledgeText ?? "");
  const catalogId: CatalogId = isCatalogId(String(body.catalogId ?? "inbox"))
    ? (body.catalogId as CatalogId)
    : "inbox";
  const chatLanguage: ChatLanguage = isChatLanguage(String(body.chatLanguage ?? "multi"))
    ? (body.chatLanguage as ChatLanguage)
    : "multi";

  if (!name) {
    return NextResponse.json({ error: "Business name is required" }, { status: 400 });
  }
  if (!intro) {
    return NextResponse.json({ error: "Intro is required" }, { status: 400 });
  }
  const idleRaw = Number(body.idleResetDays);
  const idleResetDays = Number.isFinite(idleRaw)
    ? Math.max(0, Math.min(365, Math.floor(idleRaw)))
    : 5;

  const flow = flowForCatalog(catalogId);
  const hitlPolicy = hitlForCatalog(catalogId);
  try {
    validateFlow(flow, defaultLeadSchema, hitlPolicy);
  } catch (e) {
    const msg = e instanceof FlowConfigError ? e.errors.join("\n") : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const systemPrompt = buildAgentSystemPrompt(name, intro, phone, chatLanguage);
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId } });
  let agent = await prisma.agent.findFirst({ where: { tenantId } });

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { name, phone, intro, chatLanguage, idleResetDays },
    });

    if (!agent) {
      agent = await tx.agent.create({
        data: {
          tenantId,
          name: "Inbox agent",
          catalogId,
          systemPrompt,
          knowledgeText,
          flow,
          leadSchema: defaultLeadSchema,
          hitlPolicy,
        },
      });
      return;
    }

    const nextVersion = agent.flowVersion + 1;
    await tx.agentConfigRevision.create({
      data: {
        tenantId,
        agentId: agent.id,
        kind: "flow",
        version: nextVersion,
        payload: { catalogId, flow },
      },
    });
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        catalogId,
        systemPrompt,
        knowledgeText,
        flow,
        flowVersion: nextVersion,
        flowChangedAt: new Date(),
        hitlPolicy,
        leadSchema: defaultLeadSchema,
      },
    });
  });

  return NextResponse.json({ ok: true });
}
