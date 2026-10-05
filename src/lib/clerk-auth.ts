import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkReady } from "@/lib/clerk";
import { devAuthBypassEnabled } from "@/lib/dev-auth-bypass";

/**
 * auth()/currentUser() throw if clerkMiddleware did not run (missing keys on
 * Preview, or a skipped middleware pass). Call these instead of importing auth
 * directly from Clerk in request handlers and RSC pages.
 */
export async function getClerkAuth() {
  if (devAuthBypassEnabled() || !isClerkReady()) {
    return { userId: null, orgId: null, orgRole: null };
  }
  return auth();
}

export async function getClerkUser() {
  if (devAuthBypassEnabled() || !isClerkReady()) return null;
  return currentUser();
}
