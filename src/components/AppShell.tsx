import { impersonatedTenantId, isAdminSession } from "@/lib/admin";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { actingAsLabel, uiCopy } from "@/lib/ui";
import { SidebarNav } from "@/components/SidebarNav";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const admin = await isAdminSession();
  const actingId = await impersonatedTenantId();
  const acting = actingId
    ? await prisma.tenant.findUnique({ where: { id: actingId }, select: { name: true } })
    : null;

  return (
    <div className="app-shell">
      <SidebarNav ui={ui} admin={admin} />
      <div className="app-main">
        <header className="topbar">
          {acting ? (
            <form action="/api/admin/impersonate" method="post" className="acting-chip">
              <span>{actingAsLabel(ui, acting.name)}</span>
              <button type="submit" className="btn-ghost" name="clear" value="1">
                {ui.stopActing}
              </button>
            </form>
          ) : null}
          <form action="/api/ui/lang" method="post" className="lang-toggle">
            <button type="submit" name="lang" value="he" className={lang === "he" ? "active" : ""}>
              {ui.langToggle.he}
            </button>
            <button type="submit" name="lang" value="en" className={lang === "en" ? "active" : ""}>
              {ui.langToggle.en}
            </button>
          </form>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
