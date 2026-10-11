import Link from "next/link";
import type { UiCopy } from "@/lib/ui/types";

/**
 * Notice under sign-in / sign-up. Team members are bound through their business; the owner
 * signs the service agreement separately on /accept-agreement.
 */
export function LegalConsent({ ui }: { ui: UiCopy }) {
  const l = ui.legal;
  return (
    <p className="auth-legal">
      {l.consentBefore}
      <Link href="/privacy#section-4">{l.privacy}</Link>
      {l.consentAfter}
    </p>
  );
}
