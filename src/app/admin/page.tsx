import { AdminClient } from "@/components/AdminClient";
import { PageHeader } from "@/components/PageHeader";
import { isAdminSession } from "@/lib/admin";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const unlocked = await isAdminSession();
  const tenants = unlocked
    ? await prisma.tenant.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, phone: true } })
    : [];

  return (
    <div>
      <PageHeader title={ui.page.adminTitle} />
      <AdminClient
        labels={{
          adminUnlock: ui.common.adminUnlock,
          adminSecret: ui.common.adminSecret,
          unlock: ui.common.unlock,
          createTenant: ui.common.createTenant,
          tenantName: ui.common.tenantName,
          tenantPhone: ui.common.tenantPhone,
          openAsTenant: ui.common.openAsTenant,
          badSecret: ui.errors.badSecret,
          createFailed: ui.errors.createFailed,
          search: ui.common.search,
        }}
        unlocked={unlocked}
        tenants={tenants}
      />
    </div>
  );
}
