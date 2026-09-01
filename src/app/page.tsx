import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantId = await requireTenantId();
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  const needsSetup = !(tenant?.intro ?? "").trim();

  return (
    <div>
      <h1>Leady</h1>
      <p className="muted">
        Demo as a customer in Chat. CRM shows captured fields as form controls.
        WhatsApp via Zernio sandbox. Chat preview still works without sending to WhatsApp.
      </p>
      {needsSetup ? (
        <div className="card">
          <p>
            Finish <Link href="/onboard">Setup</Link> so the agent can greet with your intro.
          </p>
        </div>
      ) : null}
      <div className="card">
        <p>
          <Link href="/demo">Open chat preview</Link>
        </p>
        <p className="muted">
          OpenAI: set <code>OPENAI_API_KEY</code> and optionally{" "}
          <code>OPENAI_CHAT_MODEL</code> (default <code>gpt-4o-mini</code>) in{" "}
          <code>.env</code>, then restart the dev server.
        </p>
      </div>
    </div>
  );
}
