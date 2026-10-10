import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { getUiLang } from "@/lib/cookies";
import { uiCopy } from "@/lib/ui";

/** Public legal pages (privacy, service agreement): no auth, no CRM chrome. */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const ui = uiCopy(await getUiLang());
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="auth-brand">
          <BrandMark id="legal" size={28} />
          <span>{ui.product}</span>
        </Link>
        <nav className="legal-nav">
          <Link href="/terms">{ui.legal.terms}</Link>
          <Link href="/privacy">{ui.legal.privacy}</Link>
          <Link href="/">{ui.legal.backToApp}</Link>
        </nav>
      </header>
      {ui.legal.hebrewOnly ? <p className="legal-note">{ui.legal.hebrewOnly}</p> : null}
      {children}
    </div>
  );
}
