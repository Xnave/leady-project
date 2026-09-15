import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { adminBypass, isAdminSession, primaryEmailFromClerkUser } from "@/lib/admin";
import { isClerkCustomDomainInviteError, clerkErrorMessage } from "@/lib/clerk-errors";
import { prisma } from "@/lib/db";
import {
  type InviteRole,
  type TenantRole,
  CLERK_ROLE_ADMIN,
  inviteRoleFromClerk,
  isInviteRole,
  normalizeEmail,
} from "@/lib/org-roles";
import { appOrigin } from "@/lib/request-url";
import { requireTenantId } from "@/lib/tenant";

export type TeamActor = {
  tenantId: string;
  clerkOrgId: string;
  userId: string;
  email: string | null;
  role: TenantRole;
};

function isOwnerOfTenant(
  tenant: { ownerEmail: string; ownerClerkUserId: string | null },
  userId: string,
  email: string | null,
): boolean {
  if (tenant.ownerClerkUserId && tenant.ownerClerkUserId === userId) return true;
  if (email && tenant.ownerEmail && normalizeEmail(email) === normalizeEmail(tenant.ownerEmail)) {
    return true;
  }
  return false;
}

export async function resolveTenantRole(
  tenant: { ownerEmail: string; ownerClerkUserId: string | null },
  userId: string,
  email: string | null,
  clerkOrgRole: string | null | undefined,
): Promise<TenantRole> {
  if (isOwnerOfTenant(tenant, userId, email)) return "owner";
  const invite = inviteRoleFromClerk(clerkOrgRole);
  return invite === "admin" ? "admin" : "member";
}

/** CRM staff in the active org (or platform admin impersonating / bypass). */
export async function requireTeamActor(): Promise<TeamActor> {
  if (adminBypass()) {
    const tenantId = await requireTenantId();
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return {
      tenantId,
      clerkOrgId: tenant.clerkOrgId,
      userId: "dev-bypass",
      email: null,
      role: "owner",
    };
  }

  // Platform admin impersonating: treat as owner for CRM, but team APIs should block mutations.
  if (await isAdminSession()) {
    const { impersonatedTenantId } = await import("@/lib/admin");
    const acting = await impersonatedTenantId();
    if (acting) {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: acting } });
      const user = await currentUser();
      return {
        tenantId: tenant.id,
        clerkOrgId: tenant.clerkOrgId,
        userId: user?.id ?? "platform-admin",
        email: await primaryEmailFromClerkUser(user),
        role: "owner",
      };
    }
  }

  const { orgId, userId, orgRole } = await auth();
  if (!userId || !orgId) throw new Error("Select a Clerk organization");
  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) throw new Error("No Leady tenant for this organization");
  const user = await currentUser();
  const email = await primaryEmailFromClerkUser(user);
  const role = await resolveTenantRole(tenant, userId, email, orgRole);
  return { tenantId: tenant.id, clerkOrgId: tenant.clerkOrgId, userId, email, role };
}

export async function requireTeamManager(): Promise<TeamActor> {
  const actor = await requireTeamActor();
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new Error("Forbidden");
  }
  // Platform admins acting as a tenant may manage team (needed before custom domain / invites).
  return actor;
}

export async function maybeBackfillOwnerClerkUserId(
  tenantId: string,
  userId: string,
  email: string | null,
): Promise<void> {
  if (!email) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || tenant.ownerClerkUserId) return;
  if (normalizeEmail(email) !== normalizeEmail(tenant.ownerEmail)) return;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { ownerClerkUserId: userId },
  });
}

export type TeamMemberRow = {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  role: TenantRole;
};

export type TeamInviteRow = {
  id: string;
  email: string;
  role: InviteRole;
  status: string;
  createdAt: number;
};

export async function listTeam(actor: TeamActor): Promise<{
  members: TeamMemberRow[];
  invites: TeamInviteRow[];
  ownerEmail: string;
}> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
  if (tenant.clerkOrgId.startsWith("local-") || tenant.clerkOrgId === "dev-org") {
    const pending = await prisma.teamPendingInvite.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return {
      members: [],
      invites: pending
        .filter((p) => isInviteRole(p.role))
        .map((p) => ({
          id: `local:${p.id}`,
          email: p.email,
          role: p.role as InviteRole,
          status: "pending_signin",
          createdAt: p.createdAt.getTime(),
        })),
      ownerEmail: tenant.ownerEmail,
    };
  }

  const client = await clerkClient();
  const [memberships, invitations, pending] = await Promise.all([
    client.organizations.getOrganizationMembershipList({
      organizationId: actor.clerkOrgId,
      limit: 100,
    }),
    client.organizations.getOrganizationInvitationList({
      organizationId: actor.clerkOrgId,
      limit: 100,
      status: ["pending"],
    }),
    prisma.teamPendingInvite.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const members: TeamMemberRow[] = memberships.data.map((m) => {
    const userId = m.publicUserData?.userId ?? m.id;
    const email = m.publicUserData?.identifier ?? null;
    const name = [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(" ") || null;
    const role = isOwnerOfTenant(tenant, userId, email)
      ? ("owner" as const)
      : inviteRoleFromClerk(m.role) === "admin"
        ? ("admin" as const)
        : ("member" as const);
    return { id: m.id, userId, email, name, role };
  });

  const clerkInvites: TeamInviteRow[] = invitations.data.map((inv) => ({
    id: inv.id,
    email: inv.emailAddress,
    role: inviteRoleFromClerk(inv.role),
    status: inv.status ?? "pending",
    createdAt: inv.createdAt,
  }));

  const localInvites: TeamInviteRow[] = pending
    .filter((p) => isInviteRole(p.role))
    .map((p) => ({
      id: `local:${p.id}`,
      email: p.email,
      role: p.role as InviteRole,
      status: "pending_signin",
      createdAt: p.createdAt.getTime(),
    }));

  const seen = new Set(clerkInvites.map((i) => normalizeEmail(i.email)));
  const invites = [
    ...clerkInvites,
    ...localInvites.filter((i) => !seen.has(normalizeEmail(i.email))),
  ];

  return { members, invites, ownerEmail: tenant.ownerEmail };
}

export type InviteTeamResult = {
  mode: "member" | "invited" | "pending_signin";
};

export async function inviteTeamMember(
  actor: TeamActor,
  emailRaw: string,
  role: InviteRole,
): Promise<InviteTeamResult> {
  const email = normalizeEmail(emailRaw);
  if (!email.includes("@")) throw new Error("Invalid email");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
  if (normalizeEmail(tenant.ownerEmail) === email) {
    throw new Error("Cannot invite the tenant owner again");
  }
  if (tenant.clerkOrgId.startsWith("local-") || tenant.clerkOrgId === "dev-org") {
    throw new Error("Team invites require a Clerk organization");
  }

  const client = await clerkClient();
  // Prefer add-if-exists; invitations require a custom domain on Clerk production.
  const existing = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  const user = existing.data[0];
  if (user) {
    await client.organizations.createOrganizationMembership({
      organizationId: actor.clerkOrgId,
      userId: user.id,
      role: role === "admin" ? CLERK_ROLE_ADMIN : "org:member",
    });
    await prisma.teamPendingInvite.deleteMany({
      where: { tenantId: actor.tenantId, email },
    });
    return { mode: "member" };
  }
  try {
    await client.organizations.createOrganizationInvitation({
      organizationId: actor.clerkOrgId,
      emailAddress: email,
      role: role === "admin" ? CLERK_ROLE_ADMIN : "org:member",
      redirectUrl: `${appOrigin()}/activating`,
      inviterUserId: actor.userId.startsWith("user_") ? actor.userId : undefined,
    });
    await prisma.teamPendingInvite.deleteMany({
      where: { tenantId: actor.tenantId, email },
    });
    return { mode: "invited" };
  } catch (e) {
    if (!isClerkCustomDomainInviteError(e)) {
      throw new Error(clerkErrorMessage(e));
    }
    // Same as tenant owner: queue locally; claimPendingTeamInvites attaches on first sign-in.
    await prisma.teamPendingInvite.upsert({
      where: { tenantId_email: { tenantId: actor.tenantId, email } },
      create: { tenantId: actor.tenantId, email, role },
      update: { role },
    });
    return { mode: "pending_signin" };
  }
}

export async function updateMemberRole(
  actor: TeamActor,
  targetUserId: string,
  nextRole: InviteRole,
): Promise<void> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
  if (tenant.ownerClerkUserId === targetUserId) {
    throw new Error("Cannot change the tenant owner role");
  }
  // Only owner may demote admins; admins may promote members → admin.
  if (nextRole === "member" && actor.role !== "owner") {
    throw new Error("Only the tenant owner can demote admins");
  }

  const client = await clerkClient();
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: actor.clerkOrgId,
    userId: [targetUserId],
    limit: 10,
  });
  const target = memberships.data[0];
  if (!target) throw new Error("Member not found");
  const targetEmail = target.publicUserData?.identifier ?? null;
  if (isOwnerOfTenant(tenant, targetUserId, targetEmail)) {
    throw new Error("Cannot change the tenant owner role");
  }
  if (inviteRoleFromClerk(target.role) === "admin" && nextRole === "member" && actor.role !== "owner") {
    throw new Error("Only the tenant owner can demote admins");
  }

  await client.organizations.updateOrganizationMembership({
    organizationId: actor.clerkOrgId,
    userId: targetUserId,
    role: nextRole === "admin" ? CLERK_ROLE_ADMIN : "org:member",
  });
}

export async function removeMember(actor: TeamActor, targetUserId: string): Promise<void> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
  if (tenant.ownerClerkUserId === targetUserId || targetUserId === actor.userId) {
    if (tenant.ownerClerkUserId === targetUserId) throw new Error("Cannot remove the tenant owner");
  }

  const client = await clerkClient();
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: actor.clerkOrgId,
    userId: [targetUserId],
    limit: 10,
  });
  const target = memberships.data[0];
  if (!target) throw new Error("Member not found");
  const targetEmail = target.publicUserData?.identifier ?? null;
  if (isOwnerOfTenant(tenant, targetUserId, targetEmail)) {
    throw new Error("Cannot remove the tenant owner");
  }
  const targetIsAdmin = inviteRoleFromClerk(target.role) === "admin";
  if (targetIsAdmin && actor.role !== "owner") {
    throw new Error("Only the tenant owner can remove admins");
  }

  await client.organizations.deleteOrganizationMembership({
    organizationId: actor.clerkOrgId,
    userId: targetUserId,
  });
}

export async function revokeInvite(actor: TeamActor, invitationId: string): Promise<void> {
  if (invitationId.startsWith("local:")) {
    const id = invitationId.slice("local:".length);
    await prisma.teamPendingInvite.deleteMany({
      where: { id, tenantId: actor.tenantId },
    });
    return;
  }

  const client = await clerkClient();
  const inv = await client.organizations.getOrganizationInvitation({
    organizationId: actor.clerkOrgId,
    invitationId,
  });
  const invRole = inviteRoleFromClerk(inv.role);
  if (invRole === "admin" && actor.role !== "owner") {
    // Admins may revoke member invites only; also allow revoking invites they created as admin→admin? Plan: admin may revoke member invites only.
    throw new Error("Only the tenant owner can revoke admin invites");
  }

  await client.organizations.revokeOrganizationInvitation({
    organizationId: actor.clerkOrgId,
    invitationId,
    requestingUserId: actor.userId.startsWith("user_") ? actor.userId : undefined,
  });
}
