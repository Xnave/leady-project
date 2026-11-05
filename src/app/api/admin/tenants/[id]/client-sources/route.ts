import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { adminTenantGate } from "@/lib/client-sources/admin-gate";
import { listClientSources, saveClientSource } from "@/lib/client-sources/store";

/** Platform admins: the tenant's connected CRMs. Responses never include credentials. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await adminTenantGate(id);
  if (denied) return denied;
  return NextResponse.json({ sources: await listClientSources(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await adminTenantGate(id);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  const label = typeof body.label === "string" ? body.label : undefined;
  const rawCredentials = body.credentials && typeof body.credentials === "object" ? (body.credentials as Record<string, unknown>) : null;
  // An all-empty credentials form means "keep what is saved".
  const credentials =
    rawCredentials && Object.values(rawCredentials).some((v) => typeof v === "string" && v.trim()) ? rawCredentials : undefined;
  const result = await saveClientSource(id, { kind, label, credentials, config: body.config });
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  const { actorLabel } = await resolveStaffActor();
  console.log(
    JSON.stringify({
      msg: "client_sources.saved",
      tenantId: id,
      sourceId: result.source.id,
      kind,
      actor: actorLabel,
      credentialsChanged: Boolean(credentials),
    }),
  );
  return NextResponse.json(result);
}
