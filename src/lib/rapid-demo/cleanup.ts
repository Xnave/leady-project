import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RAPID_DEMO_CLERK_ORG_PREFIX } from "./guards";

/** A create that died after claiming the draft should not block it forever. */
const STUCK_PROVISION_MS = 60 * 60 * 1000;

/**
 * Visitor rate limits count rows from the last day. Identity fields stay that
 * long, then the row (ipHash, browserId, page text) is deleted.
 */
const IDENTITY_RETENTION_MS = 24 * 60 * 60 * 1000;

function pageTextOf(extract: Prisma.JsonValue): string {
  if (!extract || typeof extract !== "object" || Array.isArray(extract)) return "";
  const pageText = extract.pageText;
  return typeof pageText === "string" ? pageText : "";
}

function withoutPageText(extract: Prisma.JsonValue): Prisma.InputJsonValue {
  if (!extract || typeof extract !== "object" || Array.isArray(extract)) return {};
  return { ...extract, pageText: "" };
}

/**
 * Delete throwaway demo tenants whose demo is expired, past its TTL, an old
 * draft, or stuck in provisioning. Real tenants are never matched.
 * Rows younger than the rate-limit window stay so the cap still counts them,
 * but their raw page text is wiped. ipHash and browserId go away with the row.
 */
export async function purgeExpiredRapidDemos(now = new Date()): Promise<{ tenants: number; rows: number }> {
  const stuckBefore = new Date(now.getTime() - STUCK_PROVISION_MS);
  const identityCutoff = new Date(now.getTime() - IDENTITY_RETENTION_MS);
  const stale = await prisma.rapidDemo.findMany({
    where: {
      OR: [
        { status: "expired" },
        { status: "active", expiresAt: { lt: now } },
        { status: "draft", expiresAt: { lt: now } },
        { status: "provisioning", updatedAt: { lt: stuckBefore } },
      ],
    },
    select: { id: true, tenantId: true, createdAt: true, extract: true },
  });
  if (stale.length === 0) return { tenants: 0, rows: 0 };

  const retained = stale.filter((row) => row.createdAt >= identityCutoff);
  for (const row of retained) {
    if (!pageTextOf(row.extract)) continue;
    await prisma.rapidDemo.update({
      where: { id: row.id },
      data: { extract: withoutPageText(row.extract) },
    });
  }

  const deletable = stale.filter((row) => row.createdAt < identityCutoff);
  if (deletable.length === 0) return { tenants: 0, rows: 0 };

  const tenantIds = [...new Set(deletable.flatMap((row) => (row.tenantId ? [row.tenantId] : [])))];
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
      id: { in: deletable.map((row) => row.id) },
      OR: [{ tenantId: null }, { tenant: { clerkOrgId: { startsWith: RAPID_DEMO_CLERK_ORG_PREFIX } } }],
    },
  });

  return { tenants: deletedTenants.count, rows: removed.count };
}
