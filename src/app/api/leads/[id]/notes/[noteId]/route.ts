import { NextResponse } from "next/server";
import { CrmNotFound, deleteNote, updateNote } from "@/lib/crm/actions";
import { parseNoteBody } from "@/lib/crm/input";
import { requireTenantId } from "@/lib/tenant";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;
  const tenantId = await requireTenantId();
  const body = (await req.json().catch(() => null)) as { body?: unknown; pinned?: unknown } | null;
  let text: string | undefined;
  if (body && body.body !== undefined) {
    const parsed = parseNoteBody({ body: body.body });
    if ("error" in parsed) return NextResponse.json(parsed, { status: 400 });
    text = parsed.body;
  }
  const pinned = body && typeof body.pinned === "boolean" ? body.pinned : undefined;
  try {
    await updateNote({ tenantId, leadId: id, noteId, body: text, pinned });
  } catch (e) {
    if (e instanceof CrmNotFound) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;
  const tenantId = await requireTenantId();
  try {
    await deleteNote({ tenantId, leadId: id, noteId });
  } catch (e) {
    if (e instanceof CrmNotFound) return NextResponse.json({ error: "not_found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
