import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { LegalDoc } from "@/components/legal/LegalDoc";
import { SwitchAccountActions } from "@/components/SwitchAccountActions";
import { adminBypass } from "@/lib/admin";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang } from "@/lib/cookies";
import { AGREEMENT_VERSION, pendingAgreement } from "@/lib/legal/agreement";
import source from "@/lib/legal/content/terms";
import { uiCopy } from "@/lib/ui";

export const metadata = { title: "אישור הסכם ההתקשרות | Zapidly" };

/** Owner-only gate before the CRM: the full agreement, an unticked checkbox, approve or sign out. */
export default async function AcceptAgreementPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Dev bypass has no signed-in owner; render the screen as a preview instead of redirecting.
  if (!(await pendingAgreement()) && !adminBypass()) redirect("/");

  const ui = uiCopy(await getUiLang());
  const a = ui.legal.accept;
  const { error } = await searchParams;

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <BrandMark id="accept" size={36} />
        <span>{ui.product}</span>
      </div>
      <div className="card stack accept-card">
        <h1 className="auth-message-title">{a.title}</h1>
        <p className="muted">{a.blurb}</p>
        {ui.legal.hebrewOnly ? <p className="muted">{ui.legal.hebrewOnly}</p> : null}
        <div className="accept-doc" tabIndex={0} aria-label={ui.legal.agreement}>
          <LegalDoc source={source} />
        </div>
        <Link href="/agreement" target="_blank" className="accept-full">
          {a.openFull}
        </Link>
        <form action="/api/legal/accept" method="post" className="stack">
          <input type="hidden" name="version" value={AGREEMENT_VERSION} />
          <label className="accept-check">
            <input type="checkbox" name="agree" required />
            <span>{a.checkbox}</span>
          </label>
          {error ? (
            <p role="alert" className="accept-error">
              {a.error}
            </p>
          ) : null}
          <button type="submit">{a.submit}</button>
        </form>
        {isClerkConfigured() ? <SwitchAccountActions switchLabel="" signOutLabel={a.signOut} /> : null}
      </div>
    </div>
  );
}
