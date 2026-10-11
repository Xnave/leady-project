import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { adminBypass } from "@/lib/admin";
import { getClerkAuth } from "@/lib/clerk-auth";
import { LegalNav } from "@/components/legal/LegalNav";
import { getUiLang } from "@/lib/cookies";
import { uiCopy } from "@/lib/ui";

/** Legal pages, no CRM chrome. Privacy is public; the agreement needs sign-in, so its tab shows only then. */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const ui = uiCopy(await getUiLang());
  const signedIn = adminBypass() || Boolean((await getClerkAuth()).userId);
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="auth-brand">
          <BrandMark id="legal" size={28} />
          <span>{ui.product}</span>
        </Link>
        <LegalNav agreement={signedIn ? ui.legal.agreement : null} privacy={ui.legal.privacy} back={ui.legal.backToApp} />
      </header>
      {ui.legal.hebrewOnly ? <p className="legal-note">{ui.legal.hebrewOnly}</p> : null}
      {children}
    </div>
  );
}
