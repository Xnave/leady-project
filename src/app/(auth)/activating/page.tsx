import { redirect } from "next/navigation";
import { EnsureActiveOrg } from "@/components/EnsureActiveOrg";
import { isAdminSession, primaryEmailFromClerkUser } from "@/lib/admin";
import { isClerkReady } from "@/lib/clerk";
import { getClerkAuth, getClerkUser } from "@/lib/clerk-auth";
import { getUiLang } from "@/lib/cookies";
import { resolveAccessibleOrgIds } from "@/lib/resolve-orgs";
import { uiCopy } from "@/lib/ui";

export default async function ActivatingPage() {
  if (!isClerkReady()) redirect("/sign-in");

  const { userId } = await getClerkAuth();
  if (!userId) redirect("/sign-in");

  const user = await getClerkUser();
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
