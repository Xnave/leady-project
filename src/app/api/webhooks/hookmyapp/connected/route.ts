import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncHookMyAppChannels } from "@/lib/hookmyapp-sync";

/** HookMyApp POSTs here after a customer finishes Embedded Signup / IG OAuth. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    externalId?: string;
    workspaceId?: string;
  };
  const tenant =
    (body.externalId
      ? await prisma.tenant.findFirst({ where: { id: body.externalId } })
      : null) ??
    (body.workspaceId
      ? await prisma.tenant.findFirst({ where: { hookmyappWorkspaceId: body.workspaceId } })
      : null);
  if (!tenant) return NextResponse.json({ ok: false }, { status: 404 });
  if (body.workspaceId && !tenant.hookmyappWorkspaceId) {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { hookmyappWorkspaceId: body.workspaceId },
    });
  }
  try {
    await syncHookMyAppChannels(tenant.id);
  } catch {
    /* connect may finish before token is readable; user can Sync */
  }
  return NextResponse.json({ ok: true });
}
