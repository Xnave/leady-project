import { persistInboundIfNew } from "@/lib/conversations";
import { dispatchNudgeEvent, enqueueAgentTurn, runTurnNow } from "@/lib/flow/run-turn";
import { adminBypass } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { NextResponse } from "next/server";
import { redirectPath } from "@/lib/request-url";

export async function POST(req: Request) {
  if (!adminBypass()) {
    return new NextResponse("dev only", { status: 403 });
  }
  const tenantId = await requireTenantId();
  const form = await req.formData();
  const from = String(form.get("from") ?? "+15550000000");
  const text = String(form.get("text") ?? "");
  const messageId = String(form.get("messageId") || `dev-${crypto.randomUUID()}`);

  const channel = await prisma.channelConnection.findFirstOrThrow({
    where: { tenantId, enabled: true },
  });
  const inserted = await persistInboundIfNew({
    tenantId,
    channelId: channel.id,
    agentId: channel.agentId,
    providerMessageId: messageId,
    from,
    text,
  });
  if (inserted) {
    await enqueueAgentTurn({
      tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
    // Fallback when Inngest worker is not running (local DX).
    await new Promise((r) => setTimeout(r, 800));
    const agentMsg = await prisma.message.findFirst({
      where: {
        conversationId: inserted.conversationId,
        role: "agent",
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
    });
    if (!agentMsg) {
      const turn = await runTurnNow({
        tenantId,
        conversationId: inserted.conversationId,
        triggerMessageId: inserted.messageId,
      });
      await dispatchNudgeEvent(turn.nudgeEvent);
    }
  }
  return NextResponse.redirect(redirectPath(req, "/leads"), 303);
}
