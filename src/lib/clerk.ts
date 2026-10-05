/** True when Clerk publishable key is set (client + server safe for NEXT_PUBLIC_). */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

export function isClerkSecretConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim());
}

/** Both keys present — clerkMiddleware can run and auth() is safe to call. */
export function isClerkReady(): boolean {
  return isClerkConfigured() && isClerkSecretConfigured();
}

function hostnameWithoutPort(hostname: string | undefined): string {
  return (hostname ?? "").split(":")[0] ?? "";
}

/**
 * Relative FAPI proxy path so each host (production + Vercel preview/staging)
 * proxies through itself. An absolute NEXT_PUBLIC_CLERK_PROXY_URL pinned to
 * production breaks handshake on any other *.vercel.app URL.
 */
export function clerkClientProxyUrl(hostname?: string): string | undefined {
  const host = hostnameWithoutPort(hostname);
  if (host.endsWith(".vercel.app") || (!host && process.env.VERCEL)) return "/__clerk";
  const raw = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();
  if (!raw) return undefined;
  if (raw.startsWith("/")) return raw;
  try {
    return new URL(raw).pathname || undefined;
  } catch {
    return undefined;
  }
}

/** *.vercel.app cannot CNAME Clerk FAPI, so those hosts must proxy. */
export function shouldProxyClerkFrontendApi(hostname: string): boolean {
  if (hostnameWithoutPort(hostname).endsWith(".vercel.app")) return true;
  return Boolean(clerkClientProxyUrl(hostname));
}
