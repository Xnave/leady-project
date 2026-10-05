import { NextResponse } from "next/server";
import { persistInboundIfNew } from "@/lib/conversations";
import { verifyZernioSignature } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { enqueueAgentTurn } from "@/lib/flow/run-turn";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { timeAsync } from "@/lib/perf";
import {
  contactDisplayName,
  instagramIdentityFields,
} from "@/lib/leads";
import {
  fetchZernioInboxContact,
  parseZernioMessageReceived,
  zernioWebhookSecret,
} from "@/lib/zernio";

/** Zernio dashboard URL check / browser probe - POST carries events. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "zernio" });
}

export async function POST(req: Request) {
  const raw = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const root =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  if (root?.event === "webhook.test") {
    return NextResponse.json({ ok: true });
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

  const { handleDigestReply } = await import("@/lib/crm/digest-send");
  if (await handleDigestReply({ accountId: inbound.accountId, conversationId: inbound.conversationId, from: inbound.from })) {
    return NextResponse.json({ ok: true, digest: true });
  }

  if (!inbound.accountId) {
    return new Response("unknown channel", { status: 404 });
  }
  const channel = await prisma.channelConnection.findFirst({
    where: { providerExternalId: inbound.accountId, enabled: true },
    include: { agent: true, tenant: true },
  });
  if (!channel) {
    console.warn("zernio webhook: unknown channel", {
      accountId: inbound.accountId,
      platform: inbound.platform,
    });
    return new Response("unknown channel", { status: 404 });
  }

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

  const started = Date.now();
  const { result: inserted, ms: persist_ms } = await timeAsync(() =>
    persistInboundIfNew({
      tenantId: channel.tenantId,
      channelId: channel.id,
      agentId: channel.agentId,
      providerMessageId: inbound.platformMessageId,
      from: inbound.from,
      text: inbound.text,
      displayName: contactDisplayName({
        name: senderName,
        username: channel.provider === "instagram" ? senderUsername : undefined,
        fallback: inbound.from,
      }),
      extraFields: {
        zernioConversationId: inbound.conversationId,
        // Instagram identity only — never store WA phone as instagramUsername / profile name as booking name.
        ...(channel.provider === "instagram" || inbound.platform === "instagram"
          ? instagramIdentityFields(senderName, senderUsername)
          : {}),
      },
      channel,
    }),
  );
  if (!inserted) {
    console.log(
      JSON.stringify({
        msg: "zernio.inbound",
        tenantId: channel.tenantId,
        duplicate: true,
        persist_ms,
        ms: Date.now() - started,
      }),
    );
    return new Response("ok", { status: 200 });
  }

  let enqueue_ms = 0;
  try {
    const timed = await timeAsync(() =>
      enqueueAgentTurn({
        tenantId: channel.tenantId,
        conversationId: inserted.conversationId,
        triggerMessageId: inserted.messageId,
      }),
    );
    enqueue_ms = timed.ms;
  } catch (err) {
    // Turn won't refresh CRM if enqueue never lands — keep the inbox clocks honest.
    console.warn(JSON.stringify({ msg: "zernio.enqueue_failed", error: String(err) }));
    await safeRefreshLeadState(channel.tenantId, inserted.leadId);
  }
  console.log(
    JSON.stringify({
      msg: "zernio.inbound",
      tenantId: channel.tenantId,
      conversationId: inserted.conversationId,
      persist_ms,
      enqueue_ms,
      ms: Date.now() - started,
    }),
  );
  return NextResponse.json({ ok: true });
}
