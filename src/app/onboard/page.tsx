import { OnboardWizard } from "@/components/OnboardWizard";
import { PageHeader } from "@/components/PageHeader";
import { bookingCollectFromFlow } from "@/lib/flow/booking-collect";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { requireTenantId } from "@/lib/tenant";
import type { FlowDefinition } from "@/lib/flow/types";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  if (!tenant) return <p>No tenant. Seed the DB.</p>;
  const agent = await prisma.agent.findFirst({ where: { tenantId } });

  return (
    <div>
      <PageHeader title={ui.page.setupTitle} blurb={ui.page.setupBlurb} />
      <OnboardWizard
        uiLang={lang}
        name={tenant.name}
        phone={tenant.phone ?? ""}
        intro={tenant.intro ?? ""}
        knowledgeText={agent?.knowledgeText ?? ""}
        catalogId={agent?.catalogId ?? "inbox"}
        chatLanguage={
          tenant && "chatLanguage" in tenant && typeof tenant.chatLanguage === "string"
            ? tenant.chatLanguage
            : "multi"
        }
        idleResetDays={tenant.idleResetDays ?? 5}
        venueAddress={tenant.venueAddress ?? ""}
        venueHours={tenant.venueHours ?? ""}
        bookingRequestTemplate={tenant.bookingRequestTemplate ?? ""}
        bookingApprovedTemplate={tenant.bookingApprovedTemplate ?? ""}
        bookingRejectedTemplate={tenant.bookingRejectedTemplate ?? ""}
        bookingCollect={bookingCollectFromFlow(agent?.flow as FlowDefinition | undefined)}
      />
    </div>
  );
}
