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
          digestPhone: ui.crm.digestPhone,
          digestOptInText: ui.crm.digestOptInText,
          digestFeatureOff: ui.crm.digestFeatureOff,
          save: ui.common.save,
          saving: ui.common.saving,
          saved: ui.crm.saved,
          loadFailed: ui.crm.loadFailed,
        }}
      />
    </div>
  );
}
