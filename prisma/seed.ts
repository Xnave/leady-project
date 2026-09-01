import { PrismaClient } from "@prisma/client";
import { createCipheriv, randomBytes } from "node:crypto";
import { buildAgentSystemPrompt, flowForCatalog, hitlForCatalog } from "../src/lib/flow/catalog";
import { isChatLanguage } from "../src/lib/flow/locale";
import { defaultLeadSchema } from "../src/lib/flow/validate";
import { ensureDevZernioChannel } from "../src/lib/channels/zernio-dev";

const prisma = new PrismaClient();

function encryptSecret(plain: string): string {
  const hex = process.env.APP_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes hex");
  }
  const key = Buffer.from(hex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

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
  const agent =
    existing != null
      ? await prisma.agent.update({
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
        })
      : await prisma.agent.create({
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

  const zernioChannelId = await ensureDevZernioChannel(tenant.id);
  if (!zernioChannelId) {
    await prisma.channelConnection.upsert({
      where: {
        provider_providerAccountId: {
          provider: "whatsapp",
          providerAccountId: "dev-phone",
        },
      },
      update: { agentId: agent.id, tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        agentId: agent.id,
        provider: "whatsapp",
        providerAccountId: "dev-phone",
        providerExternalId: "ch_dev",
        accessTokenEnc: encryptSecret("dev"),
        hmacSecretEnc: encryptSecret("dev-hmac"),
        verifyToken: "dev-verify",
      },
    });
  }

  console.log("Seeded tenant", tenant.id);
  console.log("Set DEV_TENANT_ID=" + tenant.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
