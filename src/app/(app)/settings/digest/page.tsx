import { PageHeader } from "@/components/PageHeader";
import { DigestSettingsForm, type DigestPreview } from "@/components/crm/DigestSettingsForm";
import { getUiLang } from "@/lib/cookies";
import { DIGEST_SECTORS, DIGEST_TEMPLATES, digestTemplatePreview, type DigestSector } from "@/lib/crm/digest-templates";
import { prisma } from "@/lib/db";
import { requireTenantIdForPage } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function DigestSettingsPage() {
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  // A sector picks which template wording the owner gets (guesthouse:
  // "booking requests", clinic: "appointment requests"). One preview each.
  const previews = Object.fromEntries(
    DIGEST_SECTORS.map((sector) => {
      const t = DIGEST_TEMPLATES[sector];
      return [sector, { body: digestTemplatePreview(t, tenant?.name ?? ""), footer: t.footer, button: t.button }];
    }),
  ) as Record<DigestSector, DigestPreview>;

  return (
    <div>
      <PageHeader title={ui.crm.digestTitle} blurb={ui.crm.digestBlurb} />
      <DigestSettingsForm
        labels={{
          digestEnabled: ui.crm.digestEnabled,
          digestHour: ui.crm.digestHour,
          digestFeatureOff: ui.crm.digestFeatureOff,
          digestSector: ui.crm.digestSector,
          digestSectorAuto: ui.crm.digestSectorAuto,
          digestSectorNames: ui.crm.digestSectorNames,
          digestConnect: ui.crm.digestConnect,
          digestConnectOpen: ui.crm.digestConnectOpen,
          digestConnectedTo: ui.crm.digestConnectedTo,
          digestDisconnect: ui.crm.digestDisconnect,
          digestNoPlatformNumber: ui.crm.digestNoPlatformNumber,
          digestWhatsAppTitle: ui.crm.digestWhatsAppTitle,
          digestSettingsTitle: ui.crm.digestSettingsTitle,
          digestStatusOn: ui.crm.digestStatusOn,
          digestStatusOff: ui.crm.digestStatusOff,
          digestStepCopy: ui.crm.digestStepCopy,
          digestStepSend: ui.crm.digestStepSend,
          digestCopy: ui.crm.digestCopy,
          digestCopied: ui.crm.digestCopied,
          digestCodeExpiry: ui.crm.digestCodeExpiry,
          digestNewCode: ui.crm.digestNewCode,
          digestRefresh: ui.crm.digestRefresh,
          digestPreview: ui.crm.digestPreview,
          digestConnectIntro: ui.crm.digestConnectIntro,
          alertsTitle: ui.crm.alertsTitle,
          alertsBlurb: ui.crm.alertsBlurb,
          alertsEnabled: ui.crm.alertsEnabled,
          alertApprovals: ui.crm.alertApprovals,
          alertHandoffs: ui.crm.alertHandoffs,
          alertsNeedConnect: ui.crm.alertsNeedConnect,
          quietHoursEnabled: ui.crm.quietHoursEnabled,
          quietFrom: ui.crm.quietFrom,
          quietTo: ui.crm.quietTo,
          quietMode: ui.crm.quietMode,
          quietModeNames: ui.crm.quietModeNames,
          save: ui.common.save,
          saving: ui.common.saving,
          saved: ui.crm.saved,
          loadFailed: ui.crm.loadFailed,
        }}
        previews={previews}
      />
    </div>
  );
}
