import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  impersonatedTenantId,
  isAdminSession,
  adminBypass,
  primaryEmailFromClerkUser,
} from "@/lib/admin";
import { claimOwnerOrganizations } from "@/lib/claim-owner";
import { claimPendingTeamInvites } from "@/lib/claim-team";
import { prisma } from "@/lib/db";

export async function requireTenantId(): Promise<string> {
  const acting = await impersonatedTenantId();
  if (acting) {
    const tenant = await prisma.tenant.findUnique({ where: { id: acting } });
    if (!tenant) throw new Error("Unknown tenant");
    return tenant.id;
  }

  if (adminBypass()) {
    const id = process.env.DEV_TENANT_ID;
    if (!id) {
      const first = await prisma.tenant.findFirst();
      if (!first) throw new Error("No tenant. Run npm run db:seed");
      return first.id;
    }
    return id;
  }

  const { orgId, userId } = await auth();
  if (!userId) throw new Error("Sign in required");
  if (!orgId) {
    if (await isAdminSession()) throw new Error("Select a tenant from Admin");
    const client = await clerkClient();
    let memberships = await client.users.getOrganizationMembershipList({
      userId,
      limit: 10,
    });
    if (memberships.data.length === 0) {
      const user = await currentUser();
      const email = await primaryEmailFromClerkUser(user);
      const claimed = [
        ...(await claimOwnerOrganizations(userId, email)),
        ...(await claimPendingTeamInvites(userId, email)),
      ];
      if (claimed.length > 0) {
        memberships = await client.users.getOrganizationMembershipList({
          userId,
          limit: 10,
        });
      }
    }
    if (memberships.data.length === 0) throw new Error("No organization membership");
    throw new Error("Activating organization");
  }
  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) {
    // Active Clerk org is not a Leady tenant (e.g. personal org). Switch via /activating.
    const user = await currentUser();
    const email = await primaryEmailFromClerkUser(user);
    const { resolveAccessibleOrgIds } = await import("@/lib/resolve-orgs");
    const leadyOrgs = await resolveAccessibleOrgIds(userId, email);
    if (leadyOrgs.length > 0) throw new Error("Activating organization");
    throw new Error("No Leady tenant for this organization");
  }
  return tenant.id;
}

/** Same as requireTenantId but redirects for page navigation. */
export async function requireTenantIdForPage(): Promise<string> {
  try {
    return await requireTenantId();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Sign in required")) redirect("/sign-in");
    if (msg.includes("Select a tenant from Admin")) redirect("/admin");
    if (msg.includes("Activating organization")) redirect("/activating");
    if (msg.includes("No organization membership")) redirect("/no-access");
    if (msg.includes("No Leady tenant")) redirect("/no-access");
    if (msg.includes("No tenant")) redirect("/admin");
    throw e;
  }
}
