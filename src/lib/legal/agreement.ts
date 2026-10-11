import { cache } from "react";
import { adminBypass, isAdminSession, primaryEmailFromClerkUser } from "@/lib/admin";
import { isClerkReady } from "@/lib/clerk";
import { getClerkAuth, getClerkUser } from "@/lib/clerk-auth";
import { prisma } from "@/lib/db";
import type { TenantRole } from "@/lib/org-roles";
import { resolveTenantRole } from "@/lib/team";
import { getTenantShell, requireTenantId } from "@/lib/tenant";

/**
 * Version of the service agreement (src/lib/legal/content/terms.ts) owners accept.
 * Bump it when the text changes materially: every owner, existing ones included,
 * is sent to /accept-agreement again on their next visit.
 */
export const AGREEMENT_VERSION = "2026-10-01";

/** Only the tenant owner signs, once per version. Platform staff (incl. acting as a tenant) never do. */
export function mustAcceptAgreement(input: {
  platformAdmin: boolean;
  role: TenantRole;
  accepted: boolean;
}): boolean {
  if (input.platformAdmin) return false;
  return input.role === "owner" && !input.accepted;
}

export type PendingAgreement = { tenantId: string; userId: string; email: string | null };

/**
 * The signed-in owner who still has to accept the current version, or null.
 * Checks the acceptance row first so accepted tenants cost one indexed read and no Clerk call.
 * Sign-in / activation problems return null and are left to the existing page guards.
 */
export const pendingAgreement = cache(async (): Promise<PendingAgreement | null> => {
  if (adminBypass() || !isClerkReady()) return null;

  let tenantId: string;
  try {
    tenantId = await requireTenantId();
  } catch {
    return null;
  }

  const accepted = await prisma.agreementAcceptance.findUnique({
    where: { tenantId_version: { tenantId, version: AGREEMENT_VERSION } },
    select: { id: true },
  });
  if (accepted) return null;

  const { userId, orgRole } = await getClerkAuth();
  if (!userId) return null;
  const tenant = await getTenantShell(tenantId);
  if (!tenant) return null;
  const email = await primaryEmailFromClerkUser(await getClerkUser());
  const role = await resolveTenantRole(tenant, userId, email, orgRole);
  const platformAdmin = await isAdminSession();

  if (!mustAcceptAgreement({ platformAdmin, role, accepted: false })) return null;
  return { tenantId, userId, email };
});
