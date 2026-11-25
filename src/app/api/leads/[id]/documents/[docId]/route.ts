import { NextResponse } from "next/server";
import { decryptBytes } from "@/lib/crypto";
import { currentDownloadUrl } from "@/lib/documents/download-link";
import { inlineContentDisposition } from "@/lib/documents/file-types";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

/** CRM download. Local test files are streamed. A real upload redirects to its stored link. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id: leadId, docId } = await params;
  const tenantId = await requireTenantId();
  const doc = await prisma.leadDocument.findFirst({
    where: { id: docId, tenantId, leadId },
  });
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (doc.bytesEnc) {
    const bytes = decryptBytes(doc.bytesEnc);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": doc.mime || "application/pdf",
        "content-disposition": inlineContentDisposition(doc.filename || "document.pdf"),
      },
    });
  }
  const url = await currentDownloadUrl(doc);
  if (url) return NextResponse.redirect(url);
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
