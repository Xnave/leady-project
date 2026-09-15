/** Best-effort message from Clerk Backend SDK / API errors. */
export function clerkErrorMessage(e: unknown, fallback = "Request failed"): string {
  if (!e || typeof e !== "object") {
    return e instanceof Error ? e.message : fallback;
  }
  const err = e as {
    message?: string;
    errors?: Array<{ longMessage?: string; message?: string; code?: string }>;
  };
  const first = err.errors?.[0];
  return first?.longMessage || first?.message || err.message || fallback;
}

export function isClerkCustomDomainInviteError(e: unknown): boolean {
  return /custom domain/i.test(clerkErrorMessage(e));
}
