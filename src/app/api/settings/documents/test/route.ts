import { NextResponse } from "next/server";
import { testDocumentsConnection } from "@/lib/documents/connect";
import { FlowConfigError } from "@/lib/flow/types";
import { tenantRoleOr403 } from "@/lib/tenant-role";

export async function POST(req: Request) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  const body = (await req.json().catch(() => null)) as {
    apiKey?: string;
    phone?: string;
  } | null;
  try {
    const found = await testDocumentsConnection({
      tenantId,
      apiKey: body?.apiKey,
      phone: body?.phone,
    });
    return NextResponse.json({ found });
  } catch (err) {
    const message = err instanceof FlowConfigError
      ? err.errors.join("\n")
      : err instanceof Error && err.message
        ? err.message
        : "Connection failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
