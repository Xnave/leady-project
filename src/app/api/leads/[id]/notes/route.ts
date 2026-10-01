import { NextResponse } from "next/server";
import { resolveStaffActor } from "@/lib/admin-decisions";
import { addNote, CrmNotFound } from "@/lib/crm/actions";
import { parseNoteBody } from "@/lib/crm/input";
import { requireTenantId } from "@/lib/tenant";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const parsed = parseNoteBody(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
  try {
    const note = await addNote({ tenantId, leadId: id, ...parsed, actor: await resolveStaffActor() });
    return NextResponse.json({ ok: true, note });
  } catch (e) {
    if (e instanceof CrmNotFound) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
}
