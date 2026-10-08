/**
 * True on Vercel (any env) or a production Node build. Use this when a secret
 * must be required rather than optional - local `next dev` stays permissive.
 *
 * Dependency-free so edge middleware and server code can import it.
 */
export function isProductionRuntime(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

/**
 * Local-only auth bypass (`DEV_AUTH_BYPASS=true`). Never active on Vercel or in a
 * production build, even if the variable leaks into that environment - otherwise
 * every signed-in user would be a platform admin who can act as any tenant.
 *
 * Dependency-free so both the edge middleware and server code can import it.
 */
export function devAuthBypassEnabled(): boolean {
  if (isProductionRuntime()) return false;
  return process.env.DEV_AUTH_BYPASS === "true";
}
