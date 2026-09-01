import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { buildAgentSystemPrompt, flowForCatalog, hitlForCatalog } from "@/lib/flow/catalog";
import { defaultLeadSchema } from "@/lib/flow/validate";

export async function ensureLocalDemoChannel(tenantId: string): Promise<string> {
  const agent = await prisma.agent.findFirst({ where: { tenantId } });
  if (!agent) throw new Error("No agent for tenant");
  const accountId = `demo-${tenantId}`;
  const existing = await prisma.channelConnection.findFirst({
    where: { tenantId, providerAccountId: accountId },
  });
  if (existing) return existing.id;
  const row = await prisma.channelConnection.create({
    data: {
      tenantId,
      agentId: agent.id,
      provider: "whatsapp",
      providerAccountId: accountId,
      providerExternalId: `local-${tenantId}`,
      apiBase: "https://zernio.com/api/v1",
      accessTokenEnc: encryptSecret("demo"),
      hmacSecretEnc: encryptSecret("demo"),
      verifyToken: `leady-${tenantId.slice(0, 12)}`,
      enabled: true,
    },
  });
  return row.id;
}

export async function createTenant(opts: { name: string; phone?: string }) {
  const name = opts.name.trim();
  const phone = (opts.phone ?? "").trim();
  const clerkOrgId = `local-${crypto.randomUUID()}`;
  const intro = "";
  const tenant = await prisma.tenant.create({
    data: {
      clerkOrgId,
      name,
      phone,
      intro,
      chatLanguage: "he",
    },
  });
  const flow = flowForCatalog("inbox");
  const hitl = hitlForCatalog("inbox");
  await prisma.agent.create({
    data: {
      tenantId: tenant.id,
      name: "Inbox agent",
      catalogId: "inbox",
      systemPrompt: buildAgentSystemPrompt(name, intro || name, phone, "he"),
      knowledgeText: "",
      flow,
      leadSchema: defaultLeadSchema,
      hitlPolicy: hitl,
    },
  });
  await ensureLocalDemoChannel(tenant.id);
  return tenant;
}
