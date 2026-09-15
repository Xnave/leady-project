import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { TeamClient } from "@/components/TeamClient";
import { getUiLang } from "@/lib/cookies";
import { requireTeamManager } from "@/lib/team";
import { uiCopy } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  try {
    await requireTeamManager();
  } catch {
    redirect("/");
  }

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
        }}
      />
    </div>
  );
}
