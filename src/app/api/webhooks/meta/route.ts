import { extractChannelIds, extractInboundMessages } from "@/lib/channels/meta";
import { persistInboundIfNew } from "@/lib/conversations";
import { decryptSecret, verifyHookMyAppHmac } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { enqueueAgentTurn } from "@/lib/flow/run-turn";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token) {
    const channel = await prisma.channelConnection.findFirst({
      where: { verifyToken: token },
    });
    if (challenge && (channel || token.startsWith("leady-"))) {
      return new Response(challenge, { status: 200 });
    }
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  let payload: ReturnType<typeof JSON.parse>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const ids = extractChannelIds(payload);
  const channel = ids.phoneNumberId
    ? await prisma.channelConnection.findFirst({
        where: { provider: "whatsapp", providerAccountId: ids.phoneNumberId, enabled: true },
      })
    : ids.instagramAccountId
      ? await prisma.channelConnection.findFirst({
          where: { provider: "instagram", providerAccountId: ids.instagramAccountId, enabled: true },
        })
      : null;

  if (!channel) return new Response("unknown channel", { status: 404 });

  if (process.env.DEV_AUTH_BYPASS === "true" && !req.headers.get("X-HookMyApp-Signature-256")) {
    // local simulate / unsigned payloads
  } else {
    const hmacSecret = decryptSecret(channel.hmacSecretEnc);
    const signature = req.headers.get("X-HookMyApp-Signature-256");
    if (!verifyHookMyAppHmac(raw, signature, hmacSecret)) {
      return new Response("bad signature", { status: 401 });
    }
  }

  const inbound = extractInboundMessages(payload);
  for (const msg of inbound) {
    if (!msg.id || !msg.from) continue;
    const inserted = await persistInboundIfNew({
      tenantId: channel.tenantId,
      channelId: channel.id,
      agentId: channel.agentId,
      providerMessageId: msg.id,
      from: msg.from,
      text: msg.text,
    });
    if (!inserted) continue;
    await enqueueAgentTurn({
      tenantId: channel.tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
  }

  return new Response("ok", { status: 200 });
}
