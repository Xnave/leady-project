"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavCounts } from "@/lib/nav-counts";
import type { UiCopy } from "@/lib/ui";

type NavKey = keyof UiCopy["nav"];

const NAV_ITEMS: { href: string; key: NavKey; adminOnly?: boolean; countKey?: keyof NavCounts }[] = [
  { href: "/", key: "home" },
  { href: "/leads", key: "leads", countKey: "leads" },
  { href: "/inbox", key: "inbox", countKey: "inbox" },
  { href: "/demo", key: "chat" },
  { href: "/onboard", key: "setup" },
  { href: "/channels", key: "channels" },
  { href: "/ops", key: "ops" },
  { href: "/admin", key: "admin", adminOnly: true },
];

export function SidebarNav({
  ui,
  admin,
  counts,
}: {
  ui: UiCopy;
  admin: boolean;
  counts: NavCounts | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <>
      <button
        type="button"
        className="btn-secondary mobile-nav-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={ui.common.menu}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <aside className={`sidebar${open ? " open" : ""}`}>
        <Link href="/" className="sidebar-brand" onClick={() => setOpen(false)}>
          <span className="sidebar-brand-mark">L</span>
          {ui.product}
        </Link>
        <nav className="sidebar-nav">
          {NAV_ITEMS.filter((item) => !item.adminOnly || admin).map((item) => {
            const count =
              item.countKey && counts ? counts[item.countKey] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${isActive(item.href) ? " active" : ""}`}
                onClick={() => setOpen(false)}
              >
                <span>{ui.nav[item.key]}</span>
                {count > 0 ? (
                  <span className="nav-badge">{count > 99 ? "99+" : count}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
