import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadPersona, savePersona } from "@/lib/persona/store";
import { PersonaConfigError } from "@/lib/persona/validate";
import { tenantRoleOr403 } from "@/lib/tenant-role";

export async function GET() {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const row = await loadPersona(prisma, access.tenantId);
  if (!row) return NextResponse.json({ error: "no agent" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PUT(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const body = (await req.json().catch(() => null)) as { persona?: unknown } | null;
  const row = await loadPersona(prisma, access.tenantId);
  if (!row) return NextResponse.json({ error: "no agent" }, { status: 404 });
  try {
    const persona = await savePersona(prisma, {
      tenantId: access.tenantId,
      agentId: row.agentId,
      raw: body?.persona,
    });
    return NextResponse.json({ persona });
  } catch (e) {
    if (e instanceof PersonaConfigError) {
      return NextResponse.json({ errors: e.errors }, { status: 400 });
    }
    throw e;
  }
}
