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

  const taken = await prisma.channelConnection.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "whatsapp",
        providerAccountId: phone,
      },
    },
  });
  if (taken && taken.tenantId !== tenantId) {
    console.error("zernio sandbox number already bound to another tenant");
    return null;
  }

  const ownedUpdate = {
    agentId: data.agentId,
    provider: data.provider,
    providerAccountId: data.providerAccountId,
    hookmyappChannelId: data.hookmyappChannelId,
    apiBase: data.apiBase,
    accessTokenEnc: data.accessTokenEnc,
    hmacSecretEnc: data.hmacSecretEnc,
    verifyToken: data.verifyToken,
    enabled: data.enabled,
  };

  if (taken) {
    await prisma.channelConnection.update({
      where: { id: taken.id },
      data: ownedUpdate,
    });
    return taken.id;
  }

  if (existingByDev) {
    await prisma.channelConnection.update({
      where: { id: existingByDev.id },
      data: ownedUpdate,
    });
    return existingByDev.id;
  }

  const row = await prisma.channelConnection.create({ data });
  return row.id;
}
