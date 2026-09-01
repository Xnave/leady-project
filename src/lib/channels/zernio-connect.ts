import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { createZernioProfile, zernioApiKey, zernioConfigured } from "@/lib/zernio";

export async function ensureZernioProfile(tenantId: string): Promise<string> {
  if (!zernioConfigured()) throw new Error("Zernio is not configured");
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId } });
  if (tenant.zernioProfileId) return tenant.zernioProfileId;
  const profileId = await createZernioProfile(tenant.name);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { zernioProfileId: profileId },
  });
  return profileId;
}

export async function bindZernioWhatsApp(opts: {
  tenantId: string;
  profileId: string;
  accountId: string;
  phone: string;
}): Promise<void> {
  const agent = await prisma.agent.findFirst({ where: { tenantId: opts.tenantId } });
  if (!agent) throw new Error("No agent");
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: opts.tenantId } });
  if (tenant.zernioProfileId && tenant.zernioProfileId !== opts.profileId) {
    throw new Error("Profile mismatch");
  }
  const phone = opts.phone.trim() || opts.accountId;
  const token = encryptSecret(zernioApiKey());
  const hmac = encryptSecret(process.env.ZERNIO_WEBHOOK_SECRET || "zernio");
  const data = {
    tenantId: opts.tenantId,
    agentId: agent.id,
    provider: "whatsapp",
    providerAccountId: phone,
    providerExternalId: opts.accountId,
    apiBase: "https://zernio.com/api/v1",
    accessTokenEnc: token,
    hmacSecretEnc: hmac,
    verifyToken: `leady-${opts.tenantId.slice(0, 12)}`,
    enabled: true,
  };

  const taken = await prisma.channelConnection.findUnique({
    where: {
      provider_providerAccountId: { provider: "whatsapp", providerAccountId: phone },
    },
  });
  if (taken && taken.tenantId !== opts.tenantId) {
    throw new Error("This WhatsApp number is already connected to another tenant");
  }
  if (taken) {
    await prisma.channelConnection.update({ where: { id: taken.id }, data });
    return;
  }

  const channels = await prisma.channelConnection.findMany({
    where: { tenantId: opts.tenantId, provider: "whatsapp" },
  });
  const live = channels.find(
    (ch) => !ch.providerAccountId.startsWith("demo-") && !ch.providerExternalId?.startsWith("local-"),
  );
  if (live) {
    await prisma.channelConnection.update({ where: { id: live.id }, data });
    return;
  }
  await prisma.channelConnection.create({ data });
}
