import { redirect } from "next/navigation";
import { getConnector } from "@/lib/client-sources/registry";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/leads";
import { requireTenantRoleForPage } from "@/lib/tenant-role";
import type { UiLang } from "@/lib/ui";
import { loadCampaignSettings, tenantWhatsAppAccount } from "./store";
import { expectedParamCount } from "./manage";

/** Owner/admin page guard for the campaigns add-on. */
export async function campaignPageAccess() {
  const access = await requireTenantRoleForPage("manager");
  const settings = await loadCampaignSettings(access.tenantId);
  if (!settings.enabled) redirect("/");
  return { ...access, settings };
}

export type EditorTemplate = { id: string; title: string; text: string; body: string; category: string; paramCount: number; examples: string[] };
export type EditorSource = { id: string; label: string; kind: string };
export type MappedTag = { key: string; label: string };

function mappedTags(kinds: string[], lang: UiLang): MappedTag[] {
  const seen = new Set<string>();
  const tags: MappedTag[] = [];
  for (const kind of kinds) {
    const connector = getConnector(kind);
    if (!connector) continue;
    for (const field of connector.fieldCatalog) {
      if (field.type !== "text" || !field.agentVisible || field.phoneKey || seen.has(field.key)) continue;
      seen.add(field.key);
      tags.push({ key: field.key, label: field.label[lang] });
    }
  }
  return tags;
}

export async function editorData(tenantId: string, lang: UiLang) {
  const [templates, sources, tenant, account] = await Promise.all([
    prisma.whatsAppTemplate.findMany({
      where: { tenantId, status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, text: true, body: true, category: true, examples: true },
    }),
    prisma.clientSource.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, kind: true },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    tenantWhatsAppAccount(tenantId),
  ]);
  return {
    templates: templates.map(
      (t): EditorTemplate => ({
        id: t.id,
        title: t.title,
        text: t.text,
        body: t.body,
        category: t.category,
        paramCount: expectedParamCount(t.body),
        examples: Array.isArray(t.examples) ? t.examples.filter((e): e is string => typeof e === "string") : [],
      }),
    ),
    sources,
    mappedTags: mappedTags(sources.map((s) => s.kind), lang),
    hasClientSource: sources.length > 0,
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
