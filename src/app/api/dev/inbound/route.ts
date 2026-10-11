import { persistInboundIfNew } from "@/lib/conversations";
import { runTurnNow, tryDispatchNudgeEvent, tryEnqueueAgentTurn } from "@/lib/flow/run-turn";
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
    const enqueued = await tryEnqueueAgentTurn({
      tenantId,
      conversationId: inserted.conversationId,
      triggerMessageId: inserted.messageId,
    });
    // Sync only when enqueue failed - never race an in-flight Inngest turn.
    if (!enqueued) {
      const turn = await runTurnNow({
        tenantId,
        conversationId: inserted.conversationId,
        triggerMessageId: inserted.messageId,
      });
      await tryDispatchNudgeEvent(turn.nudgeEvent);
    }
  }
  return NextResponse.redirect(redirectPath(req, "/leads"), 303);
}
