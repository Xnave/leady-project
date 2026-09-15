import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { SwitchAccountActions } from "@/components/SwitchAccountActions";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang } from "@/lib/cookies";
import { uiCopy } from "@/lib/ui";

export default async function SignInPage() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);

  if (!isClerkConfigured()) {
    return (
      <div className="auth-page">
        <div className="card stack form-narrow auth-message">
          <h1 className="auth-message-title">{ui.page.signInTitle}</h1>
          <p>{ui.page.clerkMissing}</p>
        </div>
      </div>
    );
  }

  const { userId } = await auth();

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="auth-brand-mark">L</span>
        <span>{ui.product}</span>
      </div>
      <p className="auth-tagline">{ui.page.signInBlurb}</p>
      {userId ? (
        <div className="card stack form-narrow auth-message">
          <h1 className="auth-message-title">{ui.page.alreadySignedInTitle}</h1>
          <p>{ui.page.alreadySignedInBlurb}</p>
          <SwitchAccountActions
            switchLabel={ui.page.switchAccountHint}
            signOutLabel={ui.common.signOut}
          />
        </div>
      ) : (
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/"
        />
      )}
    </div>
  );
}
