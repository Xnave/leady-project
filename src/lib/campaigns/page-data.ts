import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/leads";
import { requireTenantRoleForPage } from "@/lib/tenant-role";
import { redirect } from "next/navigation";
import { loadCampaignSettings, tenantWhatsAppAccount } from "./store";
import { expectedParamCount } from "./manage";

/** Owner/admin page guard for the campaigns add-on. */
export async function campaignPageAccess() {
  const access = await requireTenantRoleForPage("manager");
  const settings = await loadCampaignSettings(access.tenantId);
  if (!settings.enabled) redirect("/");
  return { ...access, settings };
}

export type EditorTemplate = { id: string; title: string; text: string; category: string; paramCount: number; examples: string[] };

export async function editorData(tenantId: string) {
  const [templates, sources, tenant, account] = await Promise.all([
    prisma.whatsAppTemplate.findMany({
      where: { tenantId, status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, text: true, body: true, category: true, examples: true },
    }),
    prisma.clientSource.count({ where: { tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    tenantWhatsAppAccount(tenantId),
  ]);
  return {
    templates: templates.map(
      (t): EditorTemplate => ({
        id: t.id,
        title: t.title,
        text: t.text,
        category: t.category,
        paramCount: expectedParamCount(t.body),
        examples: Array.isArray(t.examples) ? t.examples.filter((e): e is string => typeof e === "string") : [],
      }),
    ),
    hasClientSource: sources > 0,
    businessName: tenant?.name ?? "",
    whatsappPhone: account ? formatPhoneDisplay(account.phone) || account.phone : null,
  };
}

/** Lead ids from the leads page, kept only when they belong to this tenant. */
export async function pickedLeadIds(tenantId: string, raw: string | undefined): Promise<string[]> {
  const ids = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2000);
  if (!ids.length) return [];
  const rows = await prisma.lead.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}
