"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import type { NavCounts } from "@/lib/nav-counts";
import type { UiCopy, UiLang, UiTheme } from "@/lib/ui";

type NavKey = keyof UiCopy["nav"];

const OWNER_ITEMS: { href: string; key: NavKey; countKey?: keyof NavCounts }[] = [
  { href: "/", key: "home" },
  { href: "/inbox", key: "inbox", countKey: "inbox" },
  { href: "/leads", key: "leads", countKey: "leads" },
  { href: "/onboard", key: "setup" },
  { href: "/channels", key: "channels" },
  { href: "/demo", key: "chat" },
  { href: "/settings/team", key: "team" },
];

const STAFF_ITEMS: { href: string; key: NavKey; adminOnly?: boolean }[] = [
  { href: "/admin", key: "admin", adminOnly: true },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS: Partial<Record<NavKey, ReactNode>> = {
  home: <Icon d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />,
  inbox: <Icon d="M4 6h16v12H4zM4 12h4l2 3h4l2-3h4" />,
  leads: <Icon d="M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M5 20a7 7 0 0 1 14 0" />,
  setup: <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a7.7 7.7 0 0 0 .1-2l2-1.5-2-3.4-2.4.5a8 8 0 0 0-1.7-1L15 5h-4l-.4 2.6a8 8 0 0 0-1.7 1L6.5 8.1l-2 3.4 2 1.5a7.7 7.7 0 0 0 .1 2l-2 1.5 2 3.4 2.4-.5a8 8 0 0 0 1.7 1L11 21h4l.4-2.6a8 8 0 0 0 1.7-1l2.4.5 2-3.4z" />,
  channels: (
    <Icon d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.7A2 2 0 0 1 22 16.9z" />
  ),
  chat: <Icon d="M5 6h14v9H8l-3 4z" />,
  ops: <Icon d="M4 6h16M4 12h10M4 18h7" />,
  admin: <Icon d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7z" />,
  team: <Icon d="M16 11a3 3 0 1 0-2-5.2M8 11a3 3 0 1 0-2-5.2M4 20a6 6 0 0 1 8 0M12 20a6 6 0 0 1 8 0" />,
};

const THEME_OPTIONS: { id: UiTheme; key: "system" | "light" | "dark"; icon: ReactNode }[] = [
  {
    id: "system",
    key: "system",
    icon: <Icon d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  },
  {
    id: "light",
    key: "light",
    icon: (
      <Icon d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    ),
  },
  {
    id: "dark",
    key: "dark",
    icon: <Icon d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  },
];

export function SidebarNav({
  ui,
  admin,
  counts,
  tenantName,
  lang,
  theme,
  showTeam = false,
  showAccount = false,
}: {
  ui: UiCopy;
  admin: boolean;
  counts: NavCounts | null;
  tenantName?: string | null;
  lang: UiLang;
  theme: UiTheme;
  showTeam?: boolean;
  showAccount?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  const ownerItems = OWNER_ITEMS.filter((item) => item.key !== "team" || showTeam);
  const staffItems = STAFF_ITEMS.filter((item) => !item.adminOnly || admin);

  return (
    <>
      <button
        type="button"
        className="btn-secondary mobile-nav-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={ui.common.menu}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <aside className={`sidebar${open ? " open" : ""}`}>
        <Link href="/" className="sidebar-brand" onClick={() => setOpen(false)}>
          <span className="sidebar-brand-mark">L</span>
          {ui.product}
        </Link>
        {showAccount ? (
          <AccountMenu accountLabel={ui.common.account} signOutLabel={ui.common.signOut} />
        ) : null}
        {tenantName ? <div className="sidebar-tenant">{tenantName}</div> : null}
        <nav className="sidebar-nav">
          {ownerItems.map((item) => {
            const count = item.countKey && counts ? counts[item.countKey] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${isActive(item.href) ? " active" : ""}`}
                onClick={() => setOpen(false)}
              >
                <span className="nav-item-label">
                  {ICONS[item.key]}
                  <span>{ui.nav[item.key]}</span>
                </span>
                {count > 0 ? (
                  <span className="nav-badge" title={item.key === "leads" ? ui.crm.tabs.needs : undefined}>
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {staffItems.length > 0 ? (
            <div className="nav-staff-group">
              <div className="nav-group-label">{ui.common.staff}</div>
              {staffItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${isActive(item.href) ? " active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  <span className="nav-item-label">
                    {ICONS[item.key]}
                    <span>{ui.nav[item.key]}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </nav>
        <div className="sidebar-footer">
          <span className="lang-toggle-label">{ui.langToggle.uiLanguage}</span>
          <form action="/api/ui/lang" method="post" className="lang-toggle">
            <button type="submit" name="lang" value="he" className={lang === "he" ? "active" : ""}>
              {ui.langToggle.he}
            </button>
            <button type="submit" name="lang" value="en" className={lang === "en" ? "active" : ""}>
              {ui.langToggle.en}
            </button>
          </form>

          <span className="lang-toggle-label">{ui.themeToggle.appearance}</span>
          <form action="/api/ui/theme" method="post" className="lang-toggle theme-toggle">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="submit"
                name="theme"
                value={option.id}
                className={theme === option.id ? "active" : ""}
                aria-pressed={theme === option.id}
                aria-label={ui.themeToggle[option.key]}
                title={ui.themeToggle[option.key]}
              >
                {option.icon}
              </button>
            ))}
          </form>
        </div>
      </aside>
    </>
  );
}
