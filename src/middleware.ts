import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/no-access(.*)",
  "/activating(.*)",
  "/api/webhooks(.*)",
  "/api/inngest(.*)",
  "/api/channels/zernio/callback(.*)",
  "/api/hookmyapp/sync(.*)",
  "/api/dev/inbound(.*)",
]);

/** Local-only. Never bypass on Vercel even if DEV_AUTH_BYPASS is set in project env. */
function authBypass(): boolean {
  if (process.env.VERCEL) return false;
  return process.env.DEV_AUTH_BYPASS === "true";
}

/** Both keys required — clerkMiddleware throws if the secret is missing. */
function clerkKeysReady(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim(),
  );
}

const withClerk = clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) {
      return NextResponse.next();
    }
    // Always send signed-out users to our in-app /sign-in — never Clerk Account Portal
    // (accounts.<app>.vercel.app) which is not hosted and returns connection errors / 404.
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set("redirect_url", req.url);
    await auth.protect({ unauthenticatedUrl: signIn.toString() });
  },
  {
    // Required for *.vercel.app: Clerk cannot use DNS CNAMEs there, so FAPI is
    // proxied through this app at /__clerk (Dashboard → Domains → Verify).
    frontendApiProxy: { enabled: true },
  },
);

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (authBypass() || !clerkKeysReady()) {
    return NextResponse.next();
  }
  return withClerk(req, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk Frontend API proxy (Dashboard domain verification for vercel.app)
    "/__clerk/(.*)",
  ],
};
