import { clerkClient } from "@clerk/nextjs/server";
import { CLERK_ROLE_ADMIN, type InviteRole, normalizeEmail } from "@/lib/org-roles";

export type OrgAccessResult =
  | { mode: "added"; userId: string }
  | { mode: "invited"; invitationId: string; inviteUrl: string };

/**
 * Grant org access: add immediately if the email already has a Clerk user,
 * otherwise create an organization invitation and return its accept URL.
 * Clerk often does not deliver invite emails on development instances — callers
 * should surface `inviteUrl` in the UI.
 */
export async function grantOrganizationAccess(opts: {
  organizationId: string;
  email: string;
  role: InviteRole | "owner";
  redirectUrl: string;
  inviterUserId?: string | null;
}): Promise<OrgAccessResult> {
  const email = normalizeEmail(opts.email);
  const clerkRole = opts.role === "member" ? "org:member" : CLERK_ROLE_ADMIN;
  const client = await clerkClient();

  const existing = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  const user = existing.data[0];
  if (user) {
    const already = await client.organizations.getOrganizationMembershipList({
      organizationId: opts.organizationId,
      userId: [user.id],
      limit: 1,
    });
    if (already.data.length === 0) {
      await client.organizations.createOrganizationMembership({
        organizationId: opts.organizationId,
        userId: user.id,
        role: clerkRole,
      });
    }
    return { mode: "added", userId: user.id };
  }

  const invitation = await client.organizations.createOrganizationInvitation({
    organizationId: opts.organizationId,
    emailAddress: email,
    role: clerkRole,
    redirectUrl: opts.redirectUrl,
    ...(opts.inviterUserId?.startsWith("user_")
      ? { inviterUserId: opts.inviterUserId }
      : {}),
  });

  const inviteUrl = invitation.url;
  if (!inviteUrl) {
    throw new Error("Invitation created but Clerk returned no accept URL");
  }
  return { mode: "invited", invitationId: invitation.id, inviteUrl };
}
