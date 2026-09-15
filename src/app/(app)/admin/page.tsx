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
    ? await prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, phone: true, ownerEmail: true },
      })
    : [];

  return (
    <div>
      <PageHeader title={ui.page.adminTitle} />
      <AdminClient
        labels={{
          createTenant: ui.common.createTenant,
          tenantName: ui.common.tenantName,
          tenantPhone: ui.common.tenantPhone,
          ownerEmail: ui.common.ownerEmail,
          openAsTenant: ui.common.openAsTenant,
          createFailed: ui.errors.createFailed,
          createdClaimOnSignIn: ui.errors.createdClaimOnSignIn,
          search: ui.common.search,
          forbidden: ui.errors.forbidden,
        }}
        unlocked={unlocked}
        tenants={tenants}
      />
    </div>
  );
}
