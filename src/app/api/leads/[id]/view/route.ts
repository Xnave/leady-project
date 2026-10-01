import { NextResponse } from "next/server";
import { loadLeadView } from "@/lib/crm/view";
import { getUiLang } from "@/lib/cookies";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const dto = await loadLeadView(tenantId, id, ui, lang);
  if (!dto) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(dto);
}
