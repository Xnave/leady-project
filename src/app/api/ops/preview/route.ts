import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { previewFlow } from "@/lib/flow/preview";
import type { FlowDefinition, HitlPolicy, LeadSchema } from "@/lib/flow/types";

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  const form = await req.formData();
  const agentId = String(form.get("agentId"));
  const transcript = String(form.get("transcript") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const agent = await prisma.agent.findFirstOrThrow({
    where: { id: agentId, tenantId },
  });
  const result = await previewFlow(
    {
      flow: agent.flow as FlowDefinition,
      leadSchema: agent.leadSchema as LeadSchema,
      hitlPolicy: agent.hitlPolicy as HitlPolicy,
      knowledgeText: agent.knowledgeText,
      systemPrompt: agent.systemPrompt,
    },
    transcript,
  );

  return new NextResponse(
    `<pre>${JSON.stringify(result, null, 2)}</pre><p><a href="/ops">Back</a></p>`,
    { headers: { "content-type": "text/html" } },
  );
}
