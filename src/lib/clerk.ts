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
 * Relative FAPI proxy path for hosts that cannot CNAME Clerk (*.vercel.app).
 * Custom domains (e.g. app.zapidly.com) must NOT proxy — they use clerk.<domain>
 * DNS. Never infer proxy from `VERCEL` alone: middleware on a custom domain
 * still runs on Vercel and would break handshake with host_invalid.
 */
export function clerkClientProxyUrl(hostname?: string): string | undefined {
  const host = hostnameWithoutPort(hostname);
  if (host.endsWith(".vercel.app")) return "/__clerk";
  // Known non-vercel host → DNS / CNAME only.
  if (host) return undefined;
  // No hostname (tests / rare call sites): allow an explicit relative path only.
  const raw = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();
  if (raw?.startsWith("/")) return raw;
  return undefined;
}

/** *.vercel.app cannot CNAME Clerk FAPI, so those hosts must proxy. */
export function shouldProxyClerkFrontendApi(hostname: string): boolean {
  return Boolean(clerkClientProxyUrl(hostname));
}
