import { DocumentsSettingsForm } from "@/components/DocumentsSettingsForm";
import { PageHeader } from "@/components/PageHeader";
import { loadInstanceConfig } from "@/lib/capability-instances";
import { getUiLang } from "@/lib/cookies";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
import { publicDocumentConfig } from "@/lib/flow/document-config";
import { prisma } from "@/lib/db";
import { requireTenantRoleForPage } from "@/lib/tenant-role";
import { uiCopy } from "@/lib/ui";
import type { FlowDefinition, TalkStage } from "@/lib/flow/types";

export const dynamic = "force-dynamic";

export default async function DocumentsSettingsPage() {
  const { tenantId } = await requireTenantRoleForPage("manager");
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const [config, agent] = await Promise.all([
    loadInstanceConfig({ tenantId, capabilityId: "documents" }),
    prisma.agent.findFirst({ where: { tenantId }, select: { flow: true } }),
  ]);
  const pub = publicDocumentConfig(config);
  const talk = (agent?.flow as FlowDefinition | undefined)?.stages?.talk as TalkStage | undefined;
  const enabled = Boolean(talk?.type === "talk" && talk.capabilities?.includes("documents"));
  const rules = JSON.stringify(pub.rules ?? MORTGAGE_RULES, null, 2);

  return (
    <div>
      <PageHeader title={ui.documentsUi.settingsTitle} blurb={ui.documentsUi.settingsBlurb} />
      <DocumentsSettingsForm
        ui={ui}
        enabled={enabled}
        baseUrl={pub.baseUrl || "fake://smart"}
        hasKey={pub.hasKey}
        testPhones={pub.testPhones.join("\n")}
        rules={rules}
      />
    </div>
  );
}
