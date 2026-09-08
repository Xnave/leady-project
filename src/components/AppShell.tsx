import { impersonatedTenantId, isAdminSession } from "@/lib/admin";
import { getUiLang, getUiTheme } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { getNavCounts } from "@/lib/nav-counts";
import { requireTenantId } from "@/lib/tenant";
import { actingAsLabel, uiCopy } from "@/lib/ui";
import { SidebarNav } from "@/components/SidebarNav";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const lang = await getUiLang();
  const theme = await getUiTheme();
  const ui = uiCopy(lang);
  const admin = await isAdminSession();
  const actingId = await impersonatedTenantId();
  const acting = actingId
    ? await prisma.tenant.findUnique({ where: { id: actingId }, select: { name: true } })
    : null;

  let counts = null;
  let tenantName: string | null = null;
  try {
    const tenantId = await requireTenantId();
    const [nav, tenant] = await Promise.all([
      getNavCounts(tenantId),
      prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
    ]);
    counts = nav;
    tenantName = tenant?.name ?? null;
  } catch {
    counts = null;
  }

  return (
    <div className="app-shell">
      <SidebarNav
        ui={ui}
        admin={admin}
        counts={counts}
        tenantName={tenantName}
        lang={lang}
        theme={theme}
      />
      <div className="app-main">
        {acting ? (
          <header className="topbar">
            <form action="/api/admin/impersonate" method="post" className="acting-chip">
              <span>{actingAsLabel(ui, acting.name)}</span>
              <button type="submit" className="btn-ghost" name="clear" value="1">
                {ui.stopActing}
              </button>
            </form>
          </header>
        ) : null}
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
