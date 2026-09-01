import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import {
  fetchZernioSandbox,
  zernioApiKey,
  zernioConfigured,
  zernioSandboxNumber,
} from "@/lib/zernio";

export async function ensureDevZernioChannel(tenantId: string): Promise<string | null> {
  if (!zernioConfigured()) return null;
  const agent = await prisma.agent.findFirst({ where: { tenantId } });
  if (!agent) return null;

  let accountId = "";
  let phone = zernioSandboxNumber();
  try {
    const sandbox = await fetchZernioSandbox();
    if (sandbox?.accountId) accountId = sandbox.accountId;
    if (sandbox?.phoneNumber) phone = sandbox.phoneNumber;
  } catch (err) {
    console.error("zernio sandbox lookup failed", err);
  }
  if (!phone) return null;

  const existingByDev = await prisma.channelConnection.findFirst({
    where: { tenantId, provider: "whatsapp", providerAccountId: "dev-phone" },
  });
  const token = encryptSecret(zernioApiKey());
  const hmac = encryptSecret(process.env.ZERNIO_WEBHOOK_SECRET || "zernio");

  const data = {
    tenantId,
    agentId: agent.id,
    provider: "whatsapp",
    providerAccountId: phone,
    hookmyappChannelId: accountId || "zernio-sandbox",
    apiBase: "https://zernio.com/api/v1",
    accessTokenEnc: token,
    hmacSecretEnc: hmac,
    verifyToken: `leady-${tenantId.slice(0, 12)}`,
    enabled: true,
  };

  if (existingByDev) {
    await prisma.channelConnection.update({
      where: { id: existingByDev.id },
      data,
    });
    return existingByDev.id;
  }

  const row = await prisma.channelConnection.upsert({
    where: {
      provider_providerAccountId: {
        provider: "whatsapp",
        providerAccountId: phone,
      },
    },
    update: data,
    create: data,
  });
  return row.id;
}
