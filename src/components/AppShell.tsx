import { adminBypass, impersonatedTenantId, isAdminSession } from "@/lib/admin";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang, getUiTheme } from "@/lib/cookies";
import { getNavCounts } from "@/lib/nav-counts";
import { canManageTeamNav } from "@/lib/team";
import { getTenantShell, requireTenantId } from "@/lib/tenant";
import { canManageTenant } from "@/lib/tenant-role";
import { actingAsLabel, uiCopy } from "@/lib/ui";
import { SidebarNav } from "@/components/SidebarNav";
import { EnsureActiveOrg } from "@/components/EnsureActiveOrg";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const lang = await getUiLang();
  const theme = await getUiTheme();
  const ui = uiCopy(lang);
  const admin = await isAdminSession();
  const actingId = await impersonatedTenantId();
  const acting = actingId ? await getTenantShell(actingId) : null;
  const clerkOn = isClerkConfigured();

  let counts = null;
  let tenantName: string | null = null;
  let showTeam = false;
  let showSettings = false;
  try {
    const tenantId = await requireTenantId();
    const [nav, shell, team, manager] = await Promise.all([
      getNavCounts(tenantId),
      getTenantShell(tenantId),
      canManageTeamNav(tenantId),
      canManageTenant(),
    ]);
    counts = nav;
    tenantName = shell?.name ?? null;
    showTeam = team;
    showSettings = manager;
  } catch {
    counts = null;
  }

  return (
    <div className="app-shell">
      {clerkOn && !adminBypass() && !actingId ? <EnsureActiveOrg isPlatformAdmin={admin} /> : null}
      <SidebarNav
        ui={ui}
        admin={admin}
        counts={counts}
        tenantName={tenantName}
        lang={lang}
        theme={theme}
        showTeam={showTeam}
        showSettings={showSettings}
        showAccount={clerkOn}
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
