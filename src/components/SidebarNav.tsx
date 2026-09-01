"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { UiCopy } from "@/lib/ui";

type NavKey = keyof UiCopy["nav"];

const NAV_ITEMS: { href: string; key: NavKey; adminOnly?: boolean }[] = [
  { href: "/", key: "home" },
  { href: "/leads", key: "leads" },
  { href: "/inbox", key: "inbox" },
  { href: "/demo", key: "chat" },
  { href: "/onboard", key: "setup" },
  { href: "/channels", key: "channels" },
  { href: "/ops", key: "ops" },
  { href: "/admin", key: "admin", adminOnly: true },
];

export function SidebarNav({ ui, admin }: { ui: UiCopy; admin: boolean }) {
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
          {NAV_ITEMS.filter((item) => !item.adminOnly || admin).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive(item.href) ? " active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {ui.nav[item.key]}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
