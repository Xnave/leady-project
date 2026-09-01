import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, TENANT_COOKIE } from "@/lib/cookies";

export function adminBypass(): boolean {
  return process.env.DEV_AUTH_BYPASS === "true";
}

function adminSecret(): string {
  const secret = (process.env.ADMIN_SECRET ?? "").trim();
  if (secret) return secret;
  if (adminBypass()) return "dev-bypass";
  return "";
}

export function expectedAdminToken(): string {
  const secret = adminSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update("leady-admin-v1").digest("hex");
}

export function secretMatches(input: string): boolean {
  if (adminBypass() && !process.env.ADMIN_SECRET?.trim()) return true;
  const secret = adminSecret();
  if (!secret) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isAdminSession(): Promise<boolean> {
  const token = expectedAdminToken();
  if (!token) return false;
  const jar = await cookies();
  const got = jar.get(ADMIN_COOKIE)?.value ?? "";
  if (got && token && got.length === token.length) {
    if (timingSafeEqual(Buffer.from(got), Buffer.from(token))) return true;
  }
  return adminBypass();
}

export async function impersonatedTenantId(): Promise<string | null> {
  if (!(await isAdminSession())) return null;
  const jar = await cookies();
  const id = jar.get(TENANT_COOKIE)?.value?.trim();
  return id || null;
}
