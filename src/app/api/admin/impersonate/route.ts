import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isAdminSession } from "@/lib/admin";
import { TENANT_COOKIE } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { redirectPath } from "@/lib/request-url";

async function setActing(tenantId: string | null) {
  const jar = await cookies();
  if (!tenantId) {
    jar.delete(TENANT_COOKIE);
    return;
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error("Unknown tenant");
  jar.set(TENANT_COOKIE, tenant.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function POST(req: Request) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as { tenantId?: string | null };
    try {
      await setActing(body.tenantId ?? null);
    } catch {
      return NextResponse.json({ error: "Unknown tenant" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }
  const form = await req.formData();
  const clear = form.get("clear");
  const tenantId = clear ? null : String(form.get("tenantId") ?? "");
  try {
    await setActing(tenantId);
  } catch {
    return NextResponse.redirect(redirectPath(req, "/admin"), 303);
  }
  return NextResponse.redirect(redirectPath(req, tenantId ? "/leads" : "/admin"), 303);
}
