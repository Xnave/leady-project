import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { AdminClientSources, type ConnectorOption } from "@/components/client-sources/AdminClientSources";
import { isAdminSession } from "@/lib/admin";
import { listConnectors } from "@/lib/client-sources/registry";
import { listClientSources } from "@/lib/client-sources/store";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { fillUi, uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

/** Platform admins: connect a tenant's own CRM, test it, sync it. */
export default async function AdminClientSourcesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!(await isAdminSession())) redirect("/admin");
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) notFound();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const sources = await listClientSources(tenantId);
  const connectors: ConnectorOption[] = listConnectors().map((c) => ({
    kind: c.kind,
    label: c.label[lang],
    credentialFields: c.credentialFields.map((f) => ({ key: f.key, label: f.label[lang], secret: f.secret })),
    defaultConfig: JSON.stringify(c.parseConfig({}), null, 2),
  }));

  return (
    <div>
      <PageHeader title={fillUi(ui.clientSources.admin.title, { name: tenant.name })} blurb={ui.clientSources.admin.blurb} />
      <p>
        <Link href="/admin" className="btn-ghost">
          {ui.clientSources.admin.back}
        </Link>
      </p>
      <AdminClientSources tenantId={tenantId} copy={ui.clientSources} lang={lang} connectors={connectors} initial={sources} />
    </div>
  );
}
