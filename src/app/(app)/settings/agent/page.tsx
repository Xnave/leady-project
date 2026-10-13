import { PageHeader } from "@/components/PageHeader";
import { PersonaStudio } from "@/components/persona/PersonaStudio";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { loadPersona } from "@/lib/persona/store";
import { requireTenantRoleForPage } from "@/lib/tenant-role";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function AgentPersonaPage() {
  const { tenantId } = await requireTenantRoleForPage("manager");
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const row = await loadPersona(prisma, tenantId);
  if (!row) return <PageHeader title={ui.persona.title} blurb={ui.persona.blurb} />;
  const previewLang =
    row.chatLanguage === "he" || row.chatLanguage === "en" ? row.chatLanguage : lang === "he" ? "he" : "en";
  return (
    <div>
      <PageHeader title={ui.persona.title} blurb={ui.persona.blurb} />
      <PersonaStudio
        initial={row.persona}
        ui={ui.persona}
        businessName={row.tenantName}
        defaultPreviewLang={previewLang}
      />
    </div>
  );
}
