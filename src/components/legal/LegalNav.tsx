"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = { terms: string; privacy: string; back: string };

/** Switch between the two legal documents; the current one is marked like the sidebar's active item. */
export function LegalNav({ terms, privacy, back }: Props) {
  const pathname = usePathname();
  const tabs = [
    { href: "/terms", label: terms },
    { href: "/privacy", label: privacy },
  ];
  return (
    <nav className="legal-nav">
      <div className="legal-tabs">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link key={t.href} href={t.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              {t.label}
            </Link>
          );
        })}
      </div>
      <Link href="/" className="legal-back">
        {back}
      </Link>
    </nav>
  );
}
