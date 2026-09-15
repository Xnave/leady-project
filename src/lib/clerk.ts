/** True when Clerk publishable key is set (client + server safe for NEXT_PUBLIC_). */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

export function isClerkSecretConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim());
}
