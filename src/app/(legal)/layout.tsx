import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LegalNav } from "@/components/legal/LegalNav";
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
        <LegalNav terms={ui.legal.terms} privacy={ui.legal.privacy} back={ui.legal.backToApp} />
      </header>
      {ui.legal.hebrewOnly ? <p className="legal-note">{ui.legal.hebrewOnly}</p> : null}
      {children}
    </div>
  );
}
