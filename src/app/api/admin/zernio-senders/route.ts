import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { clearZernioSenderGateCache, zernioSenderKey } from "@/lib/zernio-sender-gate";

async function authorized(): Promise<NextResponse | null> {
  try {
    await requirePlatformAdmin();
    return null;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

function senderFrom(body: { sender?: unknown }): string {
  return zernioSenderKey(typeof body.sender === "string" ? body.sender : "");
}

export async function POST(req: Request) {
  const denied = await authorized();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { sender?: unknown };
  const senderKey = senderFrom(body);
  if (!senderKey) return NextResponse.json({ error: "Sender required" }, { status: 400 });
  const row = await prisma.zernioSenderGate.upsert({
    where: { senderKey },
    update: {},
    create: { senderKey },
    select: { senderKey: true, createdAt: true },
  });
  clearZernioSenderGateCache();
  return NextResponse.json({ senderKey: row.senderKey, createdAt: row.createdAt.toISOString() });
}

export async function DELETE(req: Request) {
  const denied = await authorized();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { sender?: unknown };
  const senderKey = senderFrom(body);
  if (!senderKey) return NextResponse.json({ error: "Sender required" }, { status: 400 });
  await prisma.zernioSenderGate.deleteMany({ where: { senderKey } });
  clearZernioSenderGateCache();
  return NextResponse.json({ ok: true });
}
