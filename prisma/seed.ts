import { PrismaClient } from "@prisma/client";
import { buildAgentSystemPrompt, flowForCatalog, hitlForCatalog } from "../src/lib/flow/catalog";
import { isChatLanguage } from "../src/lib/flow/locale";
import { defaultLeadSchema } from "../src/lib/flow/validate";
import { ensureLocalDemoChannel } from "../src/lib/provision-tenant";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { clerkOrgId: "dev-org" },
    update: {},
    create: {
      clerkOrgId: "dev-org",
      name: "Demo Kitchen Co",
      phone: "",
      intro: "We design and install kitchens.",
      chatLanguage: "multi",
    },
  });

  const inboxFlow = flowForCatalog("inbox");
  const inboxHitl = hitlForCatalog("inbox");
  const systemPrompt = buildAgentSystemPrompt(
    tenant.name,
    tenant.intro || "We design and install kitchens.",
    tenant.phone,
    isChatLanguage(tenant.chatLanguage) ? tenant.chatLanguage : "multi",
  );
  const existing = await prisma.agent.findFirst({ where: { tenantId: tenant.id } });
  if (existing != null) {
    await prisma.agent.update({
      where: { id: existing.id },
      data: {
        name: "Inbox agent",
        catalogId: "inbox",
        systemPrompt,
        knowledgeText:
          existing.knowledgeText ||
          "Filters reset by holding the side button for 5 seconds. Warranty is 2 years.",
        flow: inboxFlow,
        leadSchema: defaultLeadSchema,
        hitlPolicy: inboxHitl,
      },
    });
  } else {
    await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Inbox agent",
        catalogId: "inbox",
        systemPrompt,
        knowledgeText:
          "Filters reset by holding the side button for 5 seconds. Warranty is 2 years.",
        flow: inboxFlow,
        leadSchema: defaultLeadSchema,
        hitlPolicy: inboxHitl,
      },
    });
  }

  await ensureLocalDemoChannel(tenant.id);

  console.log("Seeded tenant", tenant.id);
  console.log("Set DEV_TENANT_ID=" + tenant.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
