import { NextResponse } from "next/server";
import { loadLeadView, type LeadViewScope } from "@/lib/crm/view";
import { getUiLang } from "@/lib/cookies";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const scopeParam = new URL(req.url).searchParams.get("scope");
  const scope: LeadViewScope = scopeParam === "lite" ? "lite" : "full";
  const dto = await loadLeadView(tenantId, id, ui, lang, scope);
  if (!dto) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(dto);
}
