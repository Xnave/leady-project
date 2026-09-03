import { NextResponse } from "next/server";
import { persistInboundIfNew } from "@/lib/conversations";
import { verifyZernioSignature } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { enqueueAgentTurn } from "@/lib/flow/run-turn";
import {
  contactDisplayName,
  instagramIdentityFields,
} from "@/lib/leads";
import {
  fetchZernioInboxContact,
  parseZernioMessageReceived,
  zernioWebhookSecret,
} from "@/lib/zernio";

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

  let senderName = inbound.senderName;
  let senderUsername = inbound.senderUsername;
  const wantsIdentity =
    channel.provider === "instagram" || inbound.platform === "instagram";
  if (wantsIdentity && (!senderName || !senderUsername)) {
    const accountId = channel.providerExternalId || inbound.accountId;
    if (accountId) {
      const contact = await fetchZernioInboxContact({
        accountId,
        conversationId: inbound.conversationId,
      });
      senderName = senderName || contact?.name;
      senderUsername = senderUsername || contact?.username;
    }
  }

  const inserted = await persistInboundIfNew({
    tenantId: channel.tenantId,
    channelId: channel.id,
    agentId: channel.agentId,
    providerMessageId: inbound.platformMessageId,
    from: inbound.from,
    text: inbound.text,
    displayName: contactDisplayName({
      name: senderName,
      username: senderUsername,
      fallback: inbound.from,
    }),
    extraFields: {
      zernioConversationId: inbound.conversationId,
      ...instagramIdentityFields(senderName, senderUsername),
    },
  });
  if (!inserted) return new Response("ok", { status: 200 });

  await enqueueAgentTurn({
    tenantId: channel.tenantId,
    conversationId: inserted.conversationId,
    triggerMessageId: inserted.messageId,
  });
  return NextResponse.json({ ok: true });
}
