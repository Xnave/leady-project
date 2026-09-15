import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { TENANT_COOKIE } from "@/lib/cookies";
import { normalizeEmail } from "@/lib/org-roles";

const DEFAULT_PLATFORM_ADMIN_EMAILS = [
  "naveine97@gmail.com",
  "snir.ai.solutions@gmail.com",
];

export function adminBypass(): boolean {
  return process.env.DEV_AUTH_BYPASS === "true";
}

export function platformAdminEmails(): Set<string> {
  const fromEnv = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  if (fromEnv.length > 0) return new Set(fromEnv);
  return new Set(DEFAULT_PLATFORM_ADMIN_EMAILS.map(normalizeEmail));
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().has(normalizeEmail(email));
}

export async function primaryEmailFromClerkUser(
  user: { primaryEmailAddressId: string | null; emailAddresses: { id: string; emailAddress: string }[] } | null,
): Promise<string | null> {
  if (!user) return null;
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
  return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
}

export async function isAdminSession(): Promise<boolean> {
  if (adminBypass()) return true;
  const user = await currentUser();
  const email = await primaryEmailFromClerkUser(user);
  return isPlatformAdminEmail(email);
}

export async function requirePlatformAdmin(): Promise<void> {
  if (!(await isAdminSession())) {
    throw new Error("Forbidden");
  }
}

export async function impersonatedTenantId(): Promise<string | null> {
  if (!(await isAdminSession())) return null;
  const jar = await cookies();
  const id = jar.get(TENANT_COOKIE)?.value?.trim();
  return id || null;
}
