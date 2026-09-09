import { NextResponse } from "next/server";
import { persistInboundIfNew } from "@/lib/conversations";
import { enqueueAgentTurn, runTurnNow } from "@/lib/flow/run-turn";
import { prisma } from "@/lib/db";
import { ensureLocalDemoChannel } from "@/lib/provision-tenant";
import { requireTenantId } from "@/lib/tenant";

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
  if (!from) from = `demo-${crypto.randomUUID().slice(0, 8)}`;

  const providerMessageId = `demo-${crypto.randomUUID()}`;
  const inserted = await persistInboundIfNew({
    tenantId,
    channelId: channel.id,
    agentId: channel.agentId,
    providerMessageId,
    from,
    text,
  });
  if (!inserted) {
    return NextResponse.json({ error: "Duplicate message" }, { status: 409 });
  }

  const enqueuedAt = new Date();
  await enqueueAgentTurn({
    tenantId,
    conversationId: inserted.conversationId,
    triggerMessageId: inserted.messageId,
  });

  const answered = await waitForAgentReply({
    conversationId: inserted.conversationId,
    after: enqueuedAt,
    timeoutMs: 18_000,
  });

  // Local DX: if Inngest worker is not running, fall back once so demo still works.
  if (!answered) {
    console.warn(
      JSON.stringify({
        msg: "demo.turn.fallback_sync",
        conversationId: inserted.conversationId,
        reason: "inngest_timeout",
      }),
    );
    await runTurnNow({
      tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
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
