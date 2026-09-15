import { SignUp } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang } from "@/lib/cookies";
import { uiCopy } from "@/lib/ui";

export default async function SignUpPage() {
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

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="auth-brand-mark">L</span>
        <span>{ui.product}</span>
      </div>
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
        forceRedirectUrl="/"
      />
    </div>
  );
}
