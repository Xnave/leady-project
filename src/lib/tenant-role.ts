import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { isAdminSession, primaryEmailFromClerkUser } from "@/lib/admin";
import { getClerkAuth, getClerkUser } from "@/lib/clerk-auth";
import type { TenantRole } from "@/lib/org-roles";
import { resolveTenantRole } from "@/lib/team";
import { getTenantShell, requireTenantId, requireTenantIdForPage } from "@/lib/tenant";

/**
 * Permission matrix (who may call what):
 * - member:  CRM work - leads, notes, stages, staff messages, HITL, requests, demo chat, digest.
 * - manager (tenant owner or admin): + channels, onboarding/setup, team.
 * - platform: platform staff only (PLATFORM_ADMIN_EMAILS, incl. acting as a tenant) -
 *   raw agent flow/policy (`/api/ops/*`) and capability-instance edits.
 */
export type TenantAccessLevel = "member" | "manager" | "platform";

export type TenantAccess = {
  tenantId: string;
  role: TenantRole;
  platformAdmin: boolean;
};

export class TenantRoleForbidden extends Error {
  constructor() {
    super("Forbidden");
    this.name = "TenantRoleForbidden";
  }
}

export function hasTenantAccess(
  access: Pick<TenantAccess, "role" | "platformAdmin">,
  level: TenantAccessLevel,
): boolean {
  if (access.platformAdmin) return true;
  if (level === "platform") return false;
  if (level === "manager") return access.role === "owner" || access.role === "admin";
  return true;
}

/** Tenant plus the caller's role in it. Platform admins resolve as owner. */
export async function resolveTenantAccess(): Promise<TenantAccess> {
  const tenantId = await requireTenantId();
  if (await isAdminSession()) return { tenantId, role: "owner", platformAdmin: true };

  const { userId, orgRole } = await getClerkAuth();
  if (!userId) throw new Error("Sign in required");
  const tenant = await getTenantShell(tenantId);
  if (!tenant) throw new Error("Unknown tenant");
  const email = await primaryEmailFromClerkUser(await getClerkUser());
  const role = await resolveTenantRole(tenant, userId, email, orgRole);
  return { tenantId, role, platformAdmin: false };
}

/** Like requireTenantId, but throws TenantRoleForbidden below `level`. */
export async function requireTenantRole(level: TenantAccessLevel): Promise<TenantAccess> {
  const access = await resolveTenantAccess();
  if (!hasTenantAccess(access, level)) throw new TenantRoleForbidden();
  return access;
}

/**
 * Route gate: the caller's access, or a 403 response to return as-is.
 *   const access = await tenantRoleOr403("manager");
 *   if (access instanceof Response) return access;
 */
export async function tenantRoleOr403(level: TenantAccessLevel): Promise<TenantAccess | NextResponse> {
  try {
    return await requireTenantRole(level);
  } catch (e) {
    if (e instanceof TenantRoleForbidden) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw e;
  }
}

/** Page guard: the usual sign-in/activation redirects, then home if the role is too low. */
export async function requireTenantRoleForPage(level: TenantAccessLevel): Promise<TenantAccess> {
  await requireTenantIdForPage();
  const access = await resolveTenantAccess();
  if (!hasTenantAccess(access, level)) redirect("/");
  return access;
}

/** Nav/UI flag; never throws. */
export async function canManageTenant(): Promise<boolean> {
  try {
    return hasTenantAccess(await resolveTenantAccess(), "manager");
  } catch {
    return false;
  }
}
