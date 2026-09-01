import { NextResponse } from "next/server";
import { persistInboundIfNew } from "@/lib/conversations";
import { verifyZernioSignature } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { enqueueAgentTurn } from "@/lib/flow/run-turn";
import { parseZernioMessageReceived, zernioWebhookSecret } from "@/lib/zernio";

export async function POST(req: Request) {
  const raw = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const inbound = parseZernioMessageReceived(payload);
  if (!inbound) {
    return new Response("ignored", { status: 200 });
  }

  const secret = zernioWebhookSecret();
  const signature =
    req.headers.get("X-Zernio-Signature") ?? req.headers.get("X-Late-Signature");
  if (secret) {
    if (!verifyZernioSignature(raw, signature, secret)) {
      return new Response("bad signature", { status: 401 });
    }
  }

  if (!inbound.accountId) {
    return new Response("unknown channel", { status: 404 });
  }
  const channel = await prisma.channelConnection.findFirst({
    where: { providerExternalId: inbound.accountId, enabled: true },
  });
  if (!channel) return new Response("unknown channel", { status: 404 });

  const inserted = await persistInboundIfNew({
    tenantId: channel.tenantId,
    channelId: channel.id,
    agentId: channel.agentId,
    providerMessageId: inbound.platformMessageId,
    from: inbound.from,
    text: inbound.text,
    extraFields: { zernioConversationId: inbound.conversationId },
  });
  if (!inserted) return new Response("ok", { status: 200 });

  await enqueueAgentTurn({
    tenantId: channel.tenantId,
    conversationId: inserted.conversationId,
    triggerMessageId: inserted.messageId,
  });
  return NextResponse.json({ ok: true });
}
