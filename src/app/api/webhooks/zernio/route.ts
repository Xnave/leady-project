import { NextResponse } from "next/server";
import { persistInboundIfNew } from "@/lib/conversations";
import { verifyZernioSignature } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { isProductionRuntime } from "@/lib/dev-auth-bypass";
import { enqueueAgentTurn } from "@/lib/flow/run-turn";
import { safeRefreshLeadState } from "@/lib/crm/refresh";
import { timeAsync } from "@/lib/perf";
import {
  contactDisplayName,
  instagramIdentityFields,
} from "@/lib/leads";
import { routeRapidDemoInbound } from "@/lib/rapid-demo/route-inbound";
import {
  fetchZernioInboxContact,
  parseZernioMessageReceived,
  zernioWebhookSecret,
} from "@/lib/zernio";
import {
  loadZernioSenderKeys,
  shouldHandleZernioSender,
  zernioGateModeFromEnv,
  zernioSenderKey,
} from "@/lib/zernio-sender-gate";

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
  // Production must never skip HMAC - without a secret anyone who knows a
  // channel providerExternalId can inject inbound traffic.
  if (!secret) {
    if (isProductionRuntime()) {
      console.error(
        JSON.stringify({ msg: "zernio.webhook_secret_missing", status: 401 }),
      );
      return new Response("webhook secret not configured", { status: 401 });
    }
  } else if (!verifyZernioSignature(raw, signature, secret)) {
    return new Response("bad signature", { status: 401 });
  }

  const { handleDigestReply } = await import("@/lib/crm/digest-send");
  // Digest traffic is owners on the platform number, not leads, so it runs
  // before the lead sender gate. Reaching here with a secret means the signature checked out above.
  const signatureVerified = Boolean(secret);
  if (
    await handleDigestReply({
      accountId: inbound.accountId,
      conversationId: inbound.conversationId,
      from: inbound.from,
      text: inbound.text,
      signatureVerified,
    })
  ) {
    return NextResponse.json({ ok: true, digest: true });
  }

  const gateMode = zernioGateModeFromEnv();
  let pauseAgent = false;
  if (gateMode !== "handle-all") {
    const gates = await loadZernioSenderKeys();
    if (!shouldHandleZernioSender(inbound.from, gates, gateMode)) {
      console.log(
        JSON.stringify({
          msg: "zernio.sender_gate",
          mode: gateMode,
          senderKey: zernioSenderKey(inbound.from),
        }),
      );
      // Preview allow-lists drop the sender so that deploy does not store every message.
      // Production pause saves the message and skips the agent, so a mistaken list entry stays in the CRM.
      if (gateMode === "allow") {
        return NextResponse.json({ ok: true, ignored: "sender-gate" });
      }
      pauseAgent = true;
    }
  }

  if (await routeRapidDemoInbound(inbound)) {
    return NextResponse.json({ ok: true, rapidDemo: true });
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
        // Instagram identity only - never store WA phone as instagramUsername / profile name as booking name.
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

  if (pauseAgent) {
    await safeRefreshLeadState(channel.tenantId, inserted.leadId);
    console.log(
      JSON.stringify({
        msg: "zernio.inbound",
        tenantId: channel.tenantId,
        conversationId: inserted.conversationId,
        persist_ms,
        agent: "skipped",
        reason: "sender-gate",
        ms: Date.now() - started,
      }),
    );
    return NextResponse.json({ ok: true, ignored: "sender-gate" });
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
    // Turn won't refresh CRM if enqueue never lands - keep the inbox clocks honest.
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
