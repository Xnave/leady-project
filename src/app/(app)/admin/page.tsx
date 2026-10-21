import { AdminClient, type AdminDemoRow } from "@/components/AdminClient";
import { PageHeader } from "@/components/PageHeader";
import { absTime } from "@/components/crm/format";
import { isAdminSession } from "@/lib/admin";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/leads";
import { readStoredExtract } from "@/lib/rapid-demo/extract";
import { RAPID_DEMO_CLERK_ORG_PREFIX } from "@/lib/rapid-demo/guards";
import { uiCopy, type UiCopy, type UiLang } from "@/lib/ui";
import { zernioGateModeFromEnv } from "@/lib/zernio-sender-gate";

export const dynamic = "force-dynamic";

function demoStatusLabel(ui: UiCopy, status: string): string {
  if (status === "draft") return ui.admin.statusDraft;
  if (status === "provisioning") return ui.admin.statusProvisioning;
  if (status === "active") return ui.admin.statusActive;
  if (status === "expired") return ui.admin.statusExpired;
  return status;
}

function demoBusinessName(tenantName: string | null | undefined, extract: unknown): string {
  const fromTenant = tenantName?.trim() ?? "";
  if (fromTenant) return fromTenant;
  return readStoredExtract(extract).name?.trim() ?? "";
}

export default async function AdminPage() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const unlocked = await isAdminSession();
  const tenants = unlocked
    ? await prisma.tenant.findMany({
        where: { NOT: { clerkOrgId: { startsWith: RAPID_DEMO_CLERK_ORG_PREFIX } } },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, phone: true, ownerEmail: true },
      })
    : [];
  const demos = unlocked ? await loadAdminDemos(lang, ui) : [];
  const gatedSenders = unlocked
    ? (
        await prisma.zernioSenderGate.findMany({
          orderBy: { createdAt: "desc" },
          select: { senderKey: true },
        })
      ).map((row) => row.senderKey)
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
          zernioGateTitle: ui.common.zernioGateTitle,
          zernioGateSender: ui.common.zernioGateSender,
          zernioGateAdd: ui.common.zernioGateAdd,
          zernioGateRemove: ui.common.zernioGateRemove,
          zernioGateEmpty: ui.common.zernioGateEmpty,
          zernioGateFormat: ui.common.zernioGateFormat,
          zernioGateHintProduction: ui.common.zernioGateHintProduction,
          zernioGateHintPreview: ui.common.zernioGateHintPreview,
          zernioGateHintLocal: ui.common.zernioGateHintLocal,
          tenantsTab: ui.admin.tenantsTab,
          demosTab: ui.admin.demosTab,
          demoCode: ui.admin.code,
          demoWebsite: ui.admin.website,
          demoCreated: ui.admin.created,
          demoExpires: ui.admin.expires,
          demoNotStarted: ui.admin.notStarted,
          demoLeads: ui.admin.leads,
          demoMessages: ui.admin.messages,
          demoViewAs: ui.admin.viewAs,
          demoEmpty: ui.admin.empty,
          demoStatus: ui.common.status,
        }}
        unlocked={unlocked}
        tenants={tenants}
        demos={demos}
        gateMode={zernioGateModeFromEnv()}
        gatedSenders={gatedSenders}
      />
    </div>
  );
}

async function loadAdminDemos(lang: UiLang, ui: UiCopy): Promise<AdminDemoRow[]> {
  const rows = await prisma.rapidDemo.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      code: true,
      status: true,
      websiteHost: true,
      boundPhone: true,
      expiresAt: true,
      createdAt: true,
      tenantId: true,
      extract: true,
      tenant: {
        select: {
          name: true,
          _count: { select: { leads: true, messages: true } },
        },
      },
    },
  });
  return rows.map((row) => {
    const rawPhone = row.boundPhone?.trim() ?? "";
    const phone = rawPhone ? formatPhoneDisplay(rawPhone) || rawPhone : "";
    return {
      id: row.id,
      name: demoBusinessName(row.tenant?.name, row.extract),
      code: row.code,
      websiteHost: row.websiteHost,
      statusLabel: demoStatusLabel(ui, row.status),
      created: absTime(row.createdAt.toISOString(), lang),
      expires: row.expiresAt ? absTime(row.expiresAt.toISOString(), lang) : "",
      phone,
      phoneQuery: `${phone} ${rawPhone}`.trim(),
      leadCount: row.tenant ? row.tenant._count.leads : null,
      messageCount: row.tenant ? row.tenant._count.messages : null,
      tenantId: row.tenantId,
    };
  });
}
