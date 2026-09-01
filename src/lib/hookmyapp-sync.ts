import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import {
  listWorkspaceChannels,
  parseChannelIdentity,
  readChannelEnv,
  readChannelToken,
  readWebhookHmac,
  setWebhookUrl,
} from "@/lib/hookmyapp";

export async function syncHookMyAppChannels(tenantId: string) {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { id: tenantId } });
  if (!tenant.hookmyappWorkspaceId) {
    throw new Error("No HookMyApp workspace on this tenant. Create a connect link first.");
  }
  const agent = await prisma.agent.findFirstOrThrow({ where: { tenantId } });
  const channels = await listWorkspaceChannels(tenant.hookmyappWorkspaceId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/meta`;
  const synced: string[] = [];

  for (const ch of channels) {
    const channelId = ch.id ?? ch.publicId;
    if (!channelId) continue;
    let env: Record<string, string> = {};
    try {
      env = await readChannelEnv(tenant.hookmyappWorkspaceId, channelId);
    } catch {
      env = {};
    }
    const parsed = parseChannelIdentity(env, ch);
    let accessToken = parsed.accessToken;
    if (!accessToken) {
      accessToken = await readChannelToken(tenant.hookmyappWorkspaceId, channelId);
    }
    let hmac = parsed.hmac;
    if (!hmac) {
      try {
        hmac = await readWebhookHmac(tenant.hookmyappWorkspaceId, channelId);
      } catch {
        hmac = "pending";
      }
    }
    const verifyToken = parsed.verifyToken || `leady-${tenantId.slice(0, 8)}`;
    if (!parsed.providerAccountId || !accessToken) continue;
    try {
      await setWebhookUrl(tenant.hookmyappWorkspaceId, channelId, webhookUrl, verifyToken);
    } catch {
      /* destination may already be set via onboarding */
    }
    await prisma.channelConnection.upsert({
      where: {
        provider_providerAccountId: {
          provider: parsed.provider,
          providerAccountId: parsed.providerAccountId,
        },
      },
      update: {
        tenantId,
        agentId: agent.id,
        hookmyappChannelId: parsed.channelId || channelId,
        apiBase: parsed.apiBase,
        accessTokenEnc: encryptSecret(accessToken),
        hmacSecretEnc: encryptSecret(hmac),
        verifyToken,
        enabled: true,
      },
      create: {
        tenantId,
        agentId: agent.id,
        provider: parsed.provider,
        providerAccountId: parsed.providerAccountId,
        hookmyappChannelId: parsed.channelId || channelId,
        apiBase: parsed.apiBase,
        accessTokenEnc: encryptSecret(accessToken),
        hmacSecretEnc: encryptSecret(hmac),
        verifyToken,
      },
    });
    synced.push(`${parsed.provider}:${parsed.providerAccountId}`);
  }
  return synced;
}
