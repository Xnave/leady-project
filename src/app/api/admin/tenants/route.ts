import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/admin";
import { createTenant } from "@/lib/provision-tenant";

export async function POST(req: Request) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string; phone?: string };
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const tenant = await createTenant({ name, phone: body.phone });
  return NextResponse.json({ id: tenant.id, name: tenant.name });
}
