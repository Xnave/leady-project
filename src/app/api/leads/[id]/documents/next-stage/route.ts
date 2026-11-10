import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { releaseNextDocumentStage } from "@/lib/documents/dossier";
import { isChatLanguage, resolveReplyLanguage } from "@/lib/flow/locale";
import { tenantRoleOr403 } from "@/lib/tenant-role";

/** Advisor action: tell the lead the next document stage is starting. Does not add document types. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await tenantRoleOr403("manager");
  if (access instanceof Response) return access;
  const { tenantId } = access;
  const { id: leadId } = await params;
  const [tenant, latest] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId }, select: { chatLanguage: true } }),
    prisma.message.findFirst({
      where: { tenantId, role: "lead", conversation: { leadId, tenantId } },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    }),
  ]);
  const stored = tenant?.chatLanguage ?? "";
  const policy = isChatLanguage(stored) ? stored : "multi";
  const lang = resolveReplyLanguage(policy, latest?.text ?? "");
  const result = await releaseNextDocumentStage(tenantId, leadId, lang);
  if (!result.ok) return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 400 });
  return NextResponse.json(result);
}
