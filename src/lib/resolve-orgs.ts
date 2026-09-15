import { clerkClient } from "@clerk/nextjs/server";
import { claimOwnerOrganizations } from "@/lib/claim-owner";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/org-roles";

/**
 * Clerk org ids this user can use in Leady (membership + a Tenant row).
 * Ignores personal/other Clerk orgs that are not provisioned tenants.
 */
export async function resolveAccessibleOrgIds(
  userId: string,
  email: string | null | undefined,
): Promise<string[]> {
  await claimOwnerOrganizations(userId, email);

  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({
    userId,
    limit: 20,
  });
  const memberOrgIds = memberships.data.map((m) => m.organization.id);
  if (memberOrgIds.length === 0) return [];

  const tenants = await prisma.tenant.findMany({
    where: { clerkOrgId: { in: memberOrgIds } },
    select: { clerkOrgId: true, ownerEmail: true },
  });

  const normalized = normalizeEmail(email ?? "");
  const byOrg = new Map(tenants.map((t) => [t.clerkOrgId, t]));
  const preferred: string[] = [];
  const rest: string[] = [];
  for (const orgId of memberOrgIds) {
    const t = byOrg.get(orgId);
    if (!t) continue;
    if (normalized && normalizeEmail(t.ownerEmail) === normalized) preferred.push(orgId);
    else rest.push(orgId);
  }
  return [...preferred, ...rest];
}
