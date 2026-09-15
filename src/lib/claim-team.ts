import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { CLERK_ROLE_ADMIN, normalizeEmail } from "@/lib/org-roles";

/**
 * Attach pending local team invites after the user signs up (no Clerk invite email
 * when the instance has no custom domain).
 */
export async function claimPendingTeamInvites(
  userId: string,
  email: string | null | undefined,
): Promise<string[]> {
  const normalized = normalizeEmail(email ?? "");
  if (!userId || !normalized) return [];

  const pending = await prisma.teamPendingInvite.findMany({
    where: { email: normalized },
    include: { tenant: { select: { id: true, clerkOrgId: true } } },
  });
  if (pending.length === 0) return [];

  const client = await clerkClient();
  const claimed: string[] = [];

  for (const row of pending) {
    const orgId = row.tenant.clerkOrgId;
    if (orgId.startsWith("local-") || orgId === "dev-org") {
      await prisma.teamPendingInvite.delete({ where: { id: row.id } });
      continue;
    }
    const clerkRole = row.role === "admin" ? CLERK_ROLE_ADMIN : "org:member";
    try {
      const already = await client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        userId: [userId],
        limit: 1,
      });
      if (already.data.length === 0) {
        await client.organizations.createOrganizationMembership({
          organizationId: orgId,
          userId,
          role: clerkRole,
        });
      }
      claimed.push(orgId);
    } catch {
      // Leave pending row for a later retry.
      continue;
    }
    await prisma.teamPendingInvite.delete({ where: { id: row.id } });
  }

  return claimed;
}
