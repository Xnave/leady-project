import Link from "next/link";
import type { UiCopy } from "@/lib/ui/types";

/** Browse-wrap notice under sign-in / sign-up, so invited team members see the terms too. */
export function LegalConsent({ ui }: { ui: UiCopy }) {
  const l = ui.legal;
  return (
    <p className="auth-legal">
      {l.consentBefore}
      <Link href="/terms">{l.terms}</Link>
      {l.consentMiddle}
      <Link href="/privacy">{l.privacy}</Link>
      {l.consentAfter}
    </p>
  );
}
