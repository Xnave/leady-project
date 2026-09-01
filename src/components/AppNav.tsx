import Link from "next/link";
import { impersonatedTenantId, isAdminSession } from "@/lib/admin";
import { getUiLang } from "@/lib/cookies";
import { prisma } from "@/lib/db";
import { uiCopy } from "@/lib/ui";

export async function AppNav() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  const admin = await isAdminSession();
  const actingId = await impersonatedTenantId();
  const acting = actingId
    ? await prisma.tenant.findUnique({ where: { id: actingId }, select: { name: true } })
    : null;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          {ui.product}
        </Link>
        <nav className="nav-links">
          <Link href="/">{ui.nav.home}</Link>
          <Link href="/onboard">{ui.nav.setup}</Link>
          <Link href="/demo">{ui.nav.chat}</Link>
          <Link href="/leads">{ui.nav.leads}</Link>
          <Link href="/inbox">{ui.nav.inbox}</Link>
          <Link href="/channels">{ui.nav.channels}</Link>
          <Link href="/ops">{ui.nav.ops}</Link>
          {admin ? <Link href="/admin">{ui.nav.admin}</Link> : null}
        </nav>
        <div className="topbar-actions">
          {acting ? (
            <form action="/api/admin/impersonate" method="post" className="acting-chip">
              <span>{ui.actingAs(acting.name)}</span>
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
        </div>
      </div>
    </header>
  );
}
