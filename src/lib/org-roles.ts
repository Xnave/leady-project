/** App-level tenant roles. Owner is also stored on Tenant.ownerEmail. */
export type TenantRole = "owner" | "admin" | "member";

/** Roles that may be assigned via invite (never a second owner). */
export type InviteRole = "admin" | "member";

/** Clerk OrganizationMembershipRole keys (defaults; owner is DB-backed). */
export const CLERK_ROLE_ADMIN = "org:admin";
export const CLERK_ROLE_MEMBER = "org:member";

export function clerkRoleForInvite(role: InviteRole): typeof CLERK_ROLE_ADMIN | typeof CLERK_ROLE_MEMBER {
  return role === "admin" ? CLERK_ROLE_ADMIN : CLERK_ROLE_MEMBER;
}

export function inviteRoleFromClerk(clerkRole: string | null | undefined): InviteRole {
  if (clerkRole === CLERK_ROLE_ADMIN || clerkRole === "admin") return "admin";
  return "member";
}

export function isInviteRole(value: unknown): value is InviteRole {
  return value === "admin" || value === "member";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
