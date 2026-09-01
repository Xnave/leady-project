import { auth } from "@clerk/nextjs/server";
import { impersonatedTenantId } from "@/lib/admin";
import { prisma } from "@/lib/db";

export async function requireTenantId(): Promise<string> {
  const acting = await impersonatedTenantId();
  if (acting) {
    const tenant = await prisma.tenant.findUnique({ where: { id: acting } });
    if (!tenant) throw new Error("Unknown tenant");
    return tenant.id;
  }

  if (process.env.DEV_AUTH_BYPASS === "true") {
    const id = process.env.DEV_TENANT_ID;
    if (!id) {
      const first = await prisma.tenant.findFirst();
      if (!first) throw new Error("No tenant. Run npm run db:seed");
      return first.id;
    }
    return id;
  }

  const { orgId } = await auth();
  if (!orgId) throw new Error("Select a Clerk organization");
  const tenant = await prisma.tenant.findUnique({ where: { clerkOrgId: orgId } });
  if (!tenant) {
    throw new Error("No Leady tenant for this organization");
  }
  return tenant.id;
}
