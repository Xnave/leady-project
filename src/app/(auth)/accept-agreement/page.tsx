import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { AgreementAcceptForm } from "@/components/legal/AgreementAcceptForm";
import { LegalDoc } from "@/components/legal/LegalDoc";
import { SwitchAccountActions } from "@/components/SwitchAccountActions";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang } from "@/lib/cookies";
import { AGREEMENT_VERSION, pendingAgreement } from "@/lib/legal/agreement";
import source from "@/lib/legal/content/terms";
import { uiCopy } from "@/lib/ui";

export const metadata = { title: "אישור הסכם ההתקשרות | Zapidly" };

/** Owner-only gate before the CRM: the full agreement (read to the end, can be enlarged), an unticked checkbox, approve or sign out. */
export default async function AcceptAgreementPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await pendingAgreement())) redirect("/");

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
        <AgreementAcceptForm
          version={AGREEMENT_VERSION}
          showError={Boolean(error)}
          copy={{
            checkbox: a.checkbox,
            submit: a.submit,
            error: a.error,
            scrollHint: a.scrollHint,
            expand: a.expand,
            collapse: a.collapse,
            docLabel: ui.legal.agreement,
          }}
        >
          <LegalDoc source={source} />
        </AgreementAcceptForm>
        {isClerkConfigured() ? <SwitchAccountActions switchLabel="" signOutLabel={a.signOut} /> : null}
      </div>
    </div>
  );
}
