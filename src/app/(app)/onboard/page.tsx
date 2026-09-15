import { OnboardWizard } from "@/components/OnboardWizard";
import { PageHeader } from "@/components/PageHeader";
import { bookingCollectFromFlow } from "@/lib/flow/booking-collect";
import { resolveBookingStance } from "@/lib/flow/catalog";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { requireTenantIdForPage } from "@/lib/tenant";
import type { FlowDefinition, TalkStage } from "@/lib/flow/types";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const tenantId = await requireTenantIdForPage();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  if (!tenant) return <p className="empty-state">{ui.errors.noTenant}</p>;
  const agent = await prisma.agent.findFirst({ where: { tenantId } });
  const flow = agent?.flow as FlowDefinition | undefined;
  const talk = flow?.stages?.talk as TalkStage | undefined;
  const capabilities = talk?.capabilities ?? undefined;
  const bookingStance = resolveBookingStance({
    catalogId: agent?.catalogId,
    stage: talk,
  });

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
        capabilities={capabilities}
        bookingStance={bookingStance}
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
        bookingCollect={bookingCollectFromFlow(flow)}
      />
    </div>
  );
}
