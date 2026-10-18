import { prisma } from "@/lib/db";
import { RAPID_DEMO_CLERK_ORG_PREFIX } from "./guards";

/** A create that died after claiming the draft should not block it forever. */
const STUCK_PROVISION_MS = 60 * 60 * 1000;

/**
 * Delete throwaway demo tenants whose demo is expired, past its TTL, an old
 * draft, or stuck in provisioning. Real tenants are never matched.
 */
export async function purgeExpiredRapidDemos(now = new Date()): Promise<{ tenants: number; rows: number }> {
  const stuckBefore = new Date(now.getTime() - STUCK_PROVISION_MS);
  const stale = await prisma.rapidDemo.findMany({
    where: {
      OR: [
        { status: "expired" },
        { status: "active", expiresAt: { lt: now } },
        { status: "draft", expiresAt: { lt: now } },
        { status: "provisioning", updatedAt: { lt: stuckBefore } },
      ],
    },
    select: { id: true, tenantId: true },
  });
  if (stale.length === 0) return { tenants: 0, rows: 0 };

  const tenantIds = [...new Set(stale.flatMap((row) => (row.tenantId ? [row.tenantId] : [])))];
  const deletedTenants =
    tenantIds.length === 0
      ? { count: 0 }
      : await prisma.tenant.deleteMany({
          where: {
            id: { in: tenantIds },
            clerkOrgId: { startsWith: RAPID_DEMO_CLERK_ORG_PREFIX },
          },
        });

  // Tenant delete cascades the demo row. This removes drafts and any row whose
  // tenant was already gone. Rows still pointing at a non-demo tenant stay.
  const removed = await prisma.rapidDemo.deleteMany({
    where: {
      id: { in: stale.map((row) => row.id) },
      OR: [{ tenantId: null }, { tenant: { clerkOrgId: { startsWith: RAPID_DEMO_CLERK_ORG_PREFIX } } }],
    },
  });

  return { tenants: deletedTenants.count, rows: removed.count };
}
