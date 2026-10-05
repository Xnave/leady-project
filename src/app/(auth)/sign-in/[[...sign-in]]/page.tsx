import { SignIn } from "@clerk/nextjs";
import { BrandMark } from "@/components/BrandMark";
import { SwitchAccountActions } from "@/components/SwitchAccountActions";
import { isClerkReady } from "@/lib/clerk";
import { getClerkAuth } from "@/lib/clerk-auth";
import { getUiLang } from "@/lib/cookies";
import { uiCopy } from "@/lib/ui";

export default async function SignInPage() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);

  if (!isClerkReady()) {
    return (
      <div className="auth-page">
        <div className="card stack form-narrow auth-message">
          <h1 className="auth-message-title">{ui.page.signInTitle}</h1>
          <p>{ui.page.clerkMissing}</p>
        </div>
      </div>
    );
  }

  const { userId } = await getClerkAuth();

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <BrandMark id="auth" size={36} />
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
