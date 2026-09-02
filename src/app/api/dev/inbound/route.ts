import { persistInboundIfNew } from "@/lib/conversations";
import { runTurnNow } from "@/lib/flow/run-turn";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";
import { NextResponse } from "next/server";
import { redirectPath } from "@/lib/request-url";

export async function POST(req: Request) {
  if (process.env.DEV_AUTH_BYPASS !== "true") {
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
    await runTurnNow({ tenantId, conversationId: inserted.conversationId });
  }
  return NextResponse.redirect(redirectPath(req, "/leads"), 303);
}
