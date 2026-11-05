import { NextResponse } from "next/server";
import { getUiLang } from "@/lib/cookies";
import { releaseNextDocumentStage } from "@/lib/documents/dossier";
import { requireTenantId } from "@/lib/tenant";

/** Advisor action: tell the lead the next document stage is starting. Does not add document types. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const tenantId = await requireTenantId();
  const lang = (await getUiLang()) === "he" ? "he" : "en";
  const result = await releaseNextDocumentStage(tenantId, leadId, lang);
  if (!result.ok) return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 });
  return NextResponse.json(result);
}
