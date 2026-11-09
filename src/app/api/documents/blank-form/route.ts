import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { loadInstanceConfig } from "@/lib/capability-instances";
import { blankFormFilePath, blankFormSignatureMatches } from "@/lib/documents/blank-form";
import { inlineContentDisposition } from "@/lib/documents/file-types";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
import { parseRules } from "@/lib/documents/rules";
import { requireTenantId } from "@/lib/tenant";

/** The blank PDF named on a document type. A signed link works without the CRM session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type")?.trim() ?? "";
  if (!type || type.includes("/") || type.includes("..")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const tenantParam = url.searchParams.get("tenant")?.trim() ?? "";
  const sig = url.searchParams.get("sig")?.trim() ?? "";
  let tenantId = "";
  if (tenantParam && sig) {
    if (!blankFormSignatureMatches(tenantParam, type, sig)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    tenantId = tenantParam;
  } else {
    tenantId = await requireTenantId();
  }
  const raw = await loadInstanceConfig({ tenantId, capabilityId: "documents" });
  let file = "";
  try {
    if (raw.rules) file = parseRules(raw.rules).documents[type]?.blankForm?.file ?? "";
  } catch {
    file = "";
  }
  if (!file) file = MORTGAGE_RULES.documents[type]?.blankForm?.file ?? "";
  const filePath = blankFormFilePath(file);
  if (!filePath) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const bytes = await readFile(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": inlineContentDisposition(file),
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
