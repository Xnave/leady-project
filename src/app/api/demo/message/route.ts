import { NextResponse } from "next/server";
import { persistInboundIfNew } from "@/lib/conversations";
import { runTurnNow, tryDispatchNudgeEvent, tryEnqueueAgentTurn } from "@/lib/flow/run-turn";
import { prisma } from "@/lib/db";
import { ensureLocalDemoChannel } from "@/lib/provision-tenant";
import { RATE_LIMITS, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { requireTenantId } from "@/lib/tenant";
import { getUiLang } from "@/lib/cookies";
import { fillUi, uiCopy } from "@/lib/ui";

/** WhatsApp caps a text message at 4096 characters. */
const MAX_DEMO_TEXT = 4096;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Wait for an agent message after the trigger, matching production Inngest path. */
async function waitForAgentReply(opts: {
  conversationId: string;
  after: Date;
  timeoutMs?: number;
}): Promise<boolean> {
  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    const msg = await prisma.message.findFirst({
      where: {
        conversationId: opts.conversationId,
        role: "agent",
        createdAt: { gt: opts.after },
      },
      orderBy: { createdAt: "desc" },
    });
    if (msg) return true;
    await sleep(400);
  }
  return false;
}

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  const body = (await req.json()) as { leadId?: string; from?: string; text?: string };
  const text = body.text?.trim() ?? "";
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  if (text.length > MAX_DEMO_TEXT) {
    return NextResponse.json({ error: "Message too long" }, { status: 413 });
  }
  const limited = await rateLimit(`demo:${tenantId}`, RATE_LIMITS.demoMessage);
  if (!limited.ok) {
    const ui = uiCopy(await getUiLang());
    return tooManyRequests(limited, fillUi(ui.errors.rateLimited, { seconds: limited.retryAfterSec }));
  }

  let channel = await prisma.channelConnection.findFirst({
    where: { tenantId, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  if (!channel) {
    await ensureLocalDemoChannel(tenantId);
    channel = await prisma.channelConnection.findFirst({
      where: { tenantId, enabled: true },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!channel) {
    return NextResponse.json({ error: "No channel" }, { status: 400 });
  }

  let from = body.from?.trim();
  if (body.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: body.leadId, tenantId },
    });
    if (!lead) return NextResponse.json({ error: "Unknown lead" }, { status: 404 });
    from = lead.externalUserId;
  }
  let displayName: string | undefined;
  if (!from) {
    from = `demo-${crypto.randomUUID().slice(0, 8)}`;
    const demoLeads = await prisma.lead.count({
      where: { tenantId, externalUserId: { startsWith: "demo-" } },
    });
    displayName = fillUi(uiCopy(await getUiLang()).demo.testCustomerName, { n: demoLeads + 1 });
  }

  const providerMessageId = `demo-${crypto.randomUUID()}`;
  const inserted = await persistInboundIfNew({
    tenantId,
    channelId: channel.id,
    agentId: channel.agentId,
    providerMessageId,
    from,
    text,
    displayName,
  });
  if (!inserted) {
    return NextResponse.json({ error: "Duplicate message" }, { status: 409 });
  }

  const enqueuedAt = new Date();
  const enqueued = await tryEnqueueAgentTurn({
    tenantId,
    conversationId: inserted.conversationId,
    triggerMessageId: inserted.messageId,
  });

  // No Inngest server: skip the wait and answer in-process right away.
  const answered = enqueued
    ? await waitForAgentReply({
        conversationId: inserted.conversationId,
        after: enqueuedAt,
        timeoutMs: 18_000,
      })
    : false;

  // Local DX: if Inngest worker is not running, fall back once so demo still works.
  if (!answered) {
    console.warn(
      JSON.stringify({
        msg: "demo.turn.fallback_sync",
        conversationId: inserted.conversationId,
        reason: enqueued ? "inngest_timeout" : "inngest_unreachable",
      }),
    );
    const turn = await runTurnNow({
      tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
    await tryDispatchNudgeEvent(turn.nudgeEvent);
  }

  const lead = await prisma.lead.findFirstOrThrow({
    where: { tenantId, channelId: channel.id, externalUserId: from },
  });
  return NextResponse.json({
    leadId: lead.id,
    conversationId: inserted.conversationId,
    viaInngest: answered,
  });
}
