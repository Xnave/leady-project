import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { CLERK_ROLE_ADMIN, normalizeEmail } from "@/lib/org-roles";

/**
 * If this user is the designated owner of a tenant but never accepted the
 * Clerk invite email, attach them to the org as admin and backfill ownerClerkUserId.
 * Returns Clerk organization ids that were claimed (including already-member orgs).
 */
export async function claimOwnerOrganizations(
  userId: string,
  email: string | null | undefined,
): Promise<string[]> {
  const normalized = normalizeEmail(email ?? "");
  if (!userId || !normalized) return [];

  const tenants = await prisma.tenant.findMany({
    where: { ownerEmail: { equals: normalized, mode: "insensitive" } },
    select: { id: true, clerkOrgId: true, ownerClerkUserId: true, ownerEmail: true },
  });

  const claimed: string[] = [];
  const client = await clerkClient();

  for (const tenant of tenants) {
    if (tenant.clerkOrgId.startsWith("local-") || tenant.clerkOrgId === "dev-org") continue;
    if (tenant.ownerClerkUserId && tenant.ownerClerkUserId !== userId) continue;

    const memberships = await client.organizations.getOrganizationMembershipList({
      organizationId: tenant.clerkOrgId,
      userId: [userId],
      limit: 1,
    });

    if (memberships.data.length === 0) {
      await client.organizations.createOrganizationMembership({
        organizationId: tenant.clerkOrgId,
        userId,
        role: CLERK_ROLE_ADMIN,
      });

      // Drop stale pending invites for this email so Clerk UI stays clean.
      try {
        const invites = await client.organizations.getOrganizationInvitationList({
          organizationId: tenant.clerkOrgId,
          status: ["pending"],
          limit: 20,
        });
        for (const inv of invites.data) {
          if (normalizeEmail(inv.emailAddress) !== normalized) continue;
          await client.organizations.revokeOrganizationInvitation({
            organizationId: tenant.clerkOrgId,
            invitationId: inv.id,
          });
        }
      } catch {
        // Non-fatal: membership is what matters for access.
      }
    }

    if (!tenant.ownerClerkUserId) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { ownerClerkUserId: userId },
      });
    }

    claimed.push(tenant.clerkOrgId);
  }

  return claimed;
}
