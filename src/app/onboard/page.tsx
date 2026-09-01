import { OnboardWizard } from "@/components/OnboardWizard";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const tenantId = await requireTenantId();
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  if (!tenant) return <p>No tenant. Seed the DB.</p>;
  const agent = await prisma.agent.findFirst({ where: { tenantId } });

  return (
    <div>
      <h1>Setup</h1>
      <p className="muted">
        Bound to this logged-in tenant. Choose the agent language at the top, then business details.
      </p>
      <OnboardWizard
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
      />
    </div>
  );
}
