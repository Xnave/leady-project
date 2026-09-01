import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@/lib/db";
import { getUiLang } from "@/lib/cookies";
import { requireTenantId } from "@/lib/tenant";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenantId = await requireTenantId();
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  const needsSetup = !(tenant?.intro ?? "").trim();

  return (
    <div>
      <PageHeader title={ui.page.homeTitle} blurb={ui.page.homeBlurb} />
      {needsSetup ? (
        <div className="card">
          <p>
            {ui.page.homeSetup} <Link href="/onboard">{ui.nav.setup}</Link>
          </p>
        </div>
      ) : null}
      <div className="card">
        <p>
          <Link href="/demo">{ui.page.homeChat}</Link>
        </p>
      </div>
    </div>
  );
}
