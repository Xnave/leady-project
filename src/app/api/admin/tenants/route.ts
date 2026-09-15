import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { isAdminSession } from "@/lib/admin";
import { createTenant } from "@/lib/provision-tenant";

export async function POST(req: Request) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    phone?: string;
    ownerEmail?: string;
  };
  const name = String(body.name ?? "").trim();
  const ownerEmail = String(body.ownerEmail ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!ownerEmail) return NextResponse.json({ error: "Owner email required" }, { status: 400 });

  const user = await currentUser();
  try {
    const tenant = await createTenant({
      name,
      phone: body.phone,
      ownerEmail,
      createdByUserId: user?.id ?? null,
    });
    return NextResponse.json({
      id: tenant.id,
      name: tenant.name,
      ownerEmail: tenant.ownerEmail,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
