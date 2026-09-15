import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SwitchAccountActions } from "@/components/SwitchAccountActions";
import { primaryEmailFromClerkUser } from "@/lib/admin";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang } from "@/lib/cookies";
import { resolveAccessibleOrgIds } from "@/lib/resolve-orgs";
import { uiCopy } from "@/lib/ui";

export default async function NoAccessPage() {
  if (!isClerkConfigured()) {
    redirect("/sign-in");
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email = await primaryEmailFromClerkUser(user);
  // Owners who already have (or just got) membership must activate — not stay here.
  const orgIds = await resolveAccessibleOrgIds(userId, email);
  if (orgIds.length > 0) redirect("/activating");

  const lang = await getUiLang();
  const ui = uiCopy(lang);

  return (
    <div className="auth-page">
      <div className="card stack form-narrow auth-message">
        <h1 className="auth-message-title">{ui.page.noAccessTitle}</h1>
        <p>{ui.page.noAccessBlurb}</p>
        <p className="muted">{ui.page.noAccessHint}</p>
        <SwitchAccountActions
          signOutLabel={ui.common.signOut}
        />
      </div>
    </div>
  );
}
