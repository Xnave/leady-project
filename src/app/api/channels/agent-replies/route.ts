import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tenantRoleOr403 } from "@/lib/tenant-role";

export async function GET() {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;

  const [tenant, channels] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { agentRepliesEnabled: true },
    }),
    prisma.channelConnection.findMany({
      where: { tenantId },
      select: { id: true, provider: true, agentRepliesEnabled: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 404 });

  return NextResponse.json({
    tenantAgentRepliesEnabled: tenant.agentRepliesEnabled,
    channels: channels.map((ch) => ({
      id: ch.id,
      provider: ch.provider,
      agentRepliesEnabled: ch.agentRepliesEnabled,
    })),
  });
}

export async function PATCH(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;

  const body = (await req.json().catch(() => ({}))) as {
    tenantAgentRepliesEnabled?: unknown;
    channelId?: unknown;
    agentRepliesEnabled?: unknown;
  };

  if (typeof body.tenantAgentRepliesEnabled === "boolean") {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { agentRepliesEnabled: body.tenantAgentRepliesEnabled },
    });
    return GET();
  }

  if (
    typeof body.channelId === "string" &&
    body.channelId.trim() &&
    typeof body.agentRepliesEnabled === "boolean"
  ) {
    const updated = await prisma.channelConnection.updateMany({
      where: { id: body.channelId, tenantId },
      data: { agentRepliesEnabled: body.agentRepliesEnabled },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return GET();
  }

  return NextResponse.json(
    {
      error:
        "Provide tenantAgentRepliesEnabled, or channelId with agentRepliesEnabled",
    },
    { status: 400 },
  );
}
