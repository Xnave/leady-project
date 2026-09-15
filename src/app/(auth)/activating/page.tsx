import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { EnsureActiveOrg } from "@/components/EnsureActiveOrg";
import { isAdminSession, primaryEmailFromClerkUser } from "@/lib/admin";
import { isClerkConfigured } from "@/lib/clerk";
import { getUiLang } from "@/lib/cookies";
import { resolveAccessibleOrgIds } from "@/lib/resolve-orgs";
import { uiCopy } from "@/lib/ui";

export default async function ActivatingPage() {
  if (!isClerkConfigured()) redirect("/sign-in");

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email = await primaryEmailFromClerkUser(user);
  const orgIds = await resolveAccessibleOrgIds(userId, email);
  const admin = await isAdminSession();

  if (orgIds.length === 0) {
    if (admin) redirect("/admin");
    redirect("/no-access");
  }

  const lang = await getUiLang();
  const ui = uiCopy(lang);

  return (
    <div className="auth-page">
      <EnsureActiveOrg isPlatformAdmin={admin} organizationId={orgIds[0]} />
      <p className="muted">{ui.page.activating}</p>
    </div>
  );
}
