import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { llmConfigured } from "@/lib/flow/model";
import type { ChatLanguage } from "@/lib/flow/locale";
import type { FlowDefinition, HitlPolicy, LeadSchema } from "@/lib/flow/types";
import { previewThrottle, runPersonaPreview } from "@/lib/persona/preview";
import { PersonaConfigError, validatePersona } from "@/lib/persona/validate";
import { tenantRoleOr403 } from "@/lib/tenant-role";

export async function POST(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  if (!llmConfigured()) return NextResponse.json({ error: "no_llm" }, { status: 409 });
  const body = (await req.json().catch(() => null)) as { persona?: unknown; lang?: string } | null;
  let persona;
  try {
    persona = validatePersona(body?.persona);
  } catch (e) {
    if (e instanceof PersonaConfigError) {
      return NextResponse.json({ errors: e.errors }, { status: 400 });
    }
    throw e;
  }
  if (!previewThrottle(access.tenantId)) {
    return NextResponse.json({ error: "slow_down" }, { status: 429 });
  }
  const agent = await prisma.agent.findFirst({
    where: { tenantId: access.tenantId },
    orderBy: { createdAt: "asc" },
    include: { tenant: { select: { name: true, phone: true, intro: true, chatLanguage: true } } },
  });
  if (!agent) return NextResponse.json({ error: "no agent" }, { status: 404 });
  const samples = await runPersonaPreview({
    persona,
    lang: body?.lang === "he" ? "he" : "en",
    agent: {
      systemPrompt: agent.systemPrompt,
      knowledgeText: agent.knowledgeText,
      flow: agent.flow as FlowDefinition,
      leadSchema: agent.leadSchema as LeadSchema,
      hitlPolicy: agent.hitlPolicy as HitlPolicy,
    },
    tenant: {
      name: agent.tenant.name,
      phone: agent.tenant.phone,
      intro: agent.tenant.intro,
      chatLanguage: agent.tenant.chatLanguage as ChatLanguage,
    },
  });
  return NextResponse.json({ samples });
}
