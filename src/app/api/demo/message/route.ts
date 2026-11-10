import { NextResponse } from "next/server";
import { encryptBytes } from "@/lib/crypto";
import { persistInboundIfNew } from "@/lib/conversations";
import { demoPhoneSender, phoneFromDemoSender } from "@/lib/demo-phone";
import { runTurnNow, tryDispatchNudgeEvent, tryDispatchOwnerAlertEvents, tryEnqueueAgentTurn } from "@/lib/flow/run-turn";
import type { FlowDefinition } from "@/lib/flow/types";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/leads";
import { ensureLocalDemoChannel } from "@/lib/provision-tenant";
import { requireTenantId } from "@/lib/tenant";
import { getUiLang } from "@/lib/cookies";
import { fillUi, uiCopy } from "@/lib/ui";

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
  const body = (await req.json()) as {
    leadId?: string;
    from?: string;
    text?: string;
    impersonatePhone?: string;
    file?: { filename?: string; mime?: string; base64?: string };
  };
  const ui = uiCopy(await getUiLang());
  if (body.impersonatePhone?.trim()) {
    const sender = demoPhoneSender(body.impersonatePhone);
    const phone = phoneFromDemoSender(sender);
    if (!sender || !phone) {
      return NextResponse.json({ error: ui.demo.impersonateInvalid }, { status: 400 });
    }
    const channelId = await ensureLocalDemoChannel(tenantId);
    const channel = await prisma.channelConnection.findFirst({
      where: { id: channelId, tenantId },
      include: { agent: true },
    });
    if (!channel) return NextResponse.json({ error: "No channel" }, { status: 400 });
    const displayName = formatPhoneDisplay(phone);
    const lead = await prisma.lead.upsert({
      where: {
        tenantId_channelId_externalUserId: { tenantId, channelId, externalUserId: sender },
      },
      create: {
        tenantId,
        channelId,
        externalUserId: sender,
        displayName,
        fields: { demoReplyHereOnly: "1" },
      },
      update: { displayName },
    });
    const open = await prisma.conversation.findFirst({
      where: { tenantId, leadId: lead.id, status: { not: "closed" } },
      select: { id: true },
    });
    if (!open) {
      const flow = channel.agent.flow as FlowDefinition;
      await prisma.conversation.create({
        data: {
          tenantId,
          leadId: lead.id,
          channelId,
          agentId: channel.agentId,
          flowState: flow.start,
          flowVersion: channel.agent.flowVersion,
          lifecycleReason: "demo_impersonate",
        },
      });
    }
    return NextResponse.json({ leadId: lead.id });
  }
  let attachments: { mime: string; filename: string; bytesEnc: string }[] | undefined;
  if (body.file?.base64) {
    const bytes = Buffer.from(body.file.base64, "base64");
    if (!bytes.length) return NextResponse.json({ error: "Empty file" }, { status: 400 });
    if (bytes.length > 8_000_000) return NextResponse.json({ error: "File is too large" }, { status: 400 });
    attachments = [
      {
        mime: body.file.mime || "application/octet-stream",
        filename: body.file.filename?.trim() || "file",
        bytesEnc: encryptBytes(bytes),
      },
    ];
  }
  const text = body.text?.trim() || attachments?.[0]?.filename || "";
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
      include: { channel: true },
    });
    if (!lead) return NextResponse.json({ error: "Unknown lead" }, { status: 404 });
    from = lead.externalUserId;
    channel = lead.channel;
  }
  let displayName: string | undefined;
  if (!from) {
    from = `demo-${crypto.randomUUID().slice(0, 8)}`;
    const demoLeads = await prisma.lead.count({
      where: { tenantId, externalUserId: { startsWith: "demo-" } },
    });
    displayName = fillUi(ui.demo.testCustomerName, { n: demoLeads + 1 });
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
    attachments,
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

  // Sync fallback only when enqueue failed - never race an in-flight Inngest turn.
  let answered = false;
  if (enqueued) {
    answered = await waitForAgentReply({
      conversationId: inserted.conversationId,
      after: enqueuedAt,
      timeoutMs: 18_000,
    });
    if (!answered) {
      console.warn(
        JSON.stringify({
          msg: "demo.turn.inngest_timeout",
          conversationId: inserted.conversationId,
          hint: "Inngest still may complete; client should poll. No sync runTurnNow.",
        }),
      );
    }
  } else {
    console.warn(
      JSON.stringify({
        msg: "demo.turn.fallback_sync",
        conversationId: inserted.conversationId,
        reason: "inngest_unreachable",
      }),
    );
    const turn = await runTurnNow({
      tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
    await tryDispatchNudgeEvent(turn.nudgeEvent);
    await tryDispatchOwnerAlertEvents(turn.ownerAlertEvents);
    answered = true;
  }

  const lead = await prisma.lead.findFirstOrThrow({
    where: { tenantId, channelId: channel.id, externalUserId: from },
  });
  const messages = await prisma.message.findMany({
    where: { tenantId, conversationId: inserted.conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, text: true, createdAt: true },
  });
  return NextResponse.json({
    leadId: lead.id,
    conversationId: inserted.conversationId,
    viaInngest: enqueued && answered,
    messages,
  });
}
