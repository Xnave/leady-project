import { NextResponse } from "next/server";
import { persistInboundIfNew } from "@/lib/conversations";
import { runTurnNow } from "@/lib/flow/run-turn";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export async function POST(req: Request) {
  const tenantId = await requireTenantId();
  const body = (await req.json()) as { leadId?: string; from?: string; text?: string };
  const text = body.text?.trim() ?? "";
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const channel = await prisma.channelConnection.findFirst({
    where: { tenantId, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  if (!channel) {
    return NextResponse.json({ error: "No channel. Seed the DB or add Zernio keys." }, { status: 400 });
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

  const inserted = await persistInboundIfNew({
    tenantId,
    channelId: channel.id,
    agentId: channel.agentId,
    providerMessageId: `demo-${crypto.randomUUID()}`,
    from,
    text,
  });
  if (!inserted) {
    return NextResponse.json({ error: "Duplicate message" }, { status: 409 });
  }

  await runTurnNow({ tenantId, conversationId: inserted.conversationId });
  const lead = await prisma.lead.findFirstOrThrow({
    where: { tenantId, channelId: channel.id, externalUserId: from },
  });
  return NextResponse.json({ leadId: lead.id, conversationId: inserted.conversationId });
}
