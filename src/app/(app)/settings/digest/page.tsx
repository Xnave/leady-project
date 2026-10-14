import { PageHeader } from "@/components/PageHeader";
import { DigestSettingsForm } from "@/components/crm/DigestSettingsForm";
import { getUiLang } from "@/lib/cookies";
import { requireTenantIdForPage } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function DigestSettingsPage() {
  await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);

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
          digestConnectHint: ui.crm.digestConnectHint,
          digestConnectOpen: ui.crm.digestConnectOpen,
          digestConnectedTo: ui.crm.digestConnectedTo,
          digestDisconnect: ui.crm.digestDisconnect,
          digestNoPlatformNumber: ui.crm.digestNoPlatformNumber,
          save: ui.common.save,
          saving: ui.common.saving,
          saved: ui.crm.saved,
          loadFailed: ui.crm.loadFailed,
        }}
      />
    </div>
  );
}
