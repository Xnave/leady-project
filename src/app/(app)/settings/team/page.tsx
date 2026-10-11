import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { LegalCard } from "@/components/legal/LegalCard";
import { TeamClient } from "@/components/TeamClient";
import { getUiLang } from "@/lib/cookies";
import { requireTeamManager } from "@/lib/team";
import { isTenantOwner } from "@/lib/tenant-role";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  let tenantId: string;
  try {
    tenantId = (await requireTeamManager()).tenantId;
  } catch {
    redirect("/");
  }
  const owner = await isTenantOwner();

  return (
    <div>
      <PageHeader title={ui.page.teamTitle} />
      <p className="muted">{ui.page.teamBlurb}</p>
      <TeamClient
        labels={{
          inviteEmail: ui.team.inviteEmail,
          inviteRole: ui.team.inviteRole,
          inviteSend: ui.team.inviteSend,
          members: ui.team.members,
          pendingInvites: ui.team.pendingInvites,
          roleOwner: ui.team.roleOwner,
          roleAdmin: ui.team.roleAdmin,
          roleMember: ui.team.roleMember,
          promote: ui.team.promote,
          demote: ui.team.demote,
          remove: ui.team.remove,
          revoke: ui.team.revoke,
          loadFailed: ui.team.loadFailed,
          empty: ui.team.empty,
          inviteClaimOnSignIn: ui.team.inviteClaimOnSignIn,
        }}
      />
      <LegalCard tenantId={tenantId} owner={owner} ui={ui} lang={lang} />
    </div>
  );
}
