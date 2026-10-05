import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkClientProxyUrl, isClerkReady } from "@/lib/clerk";
import { devAuthBypassEnabled } from "@/lib/dev-auth-bypass";

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
  (req) => {
    // Proxy only on *.vercel.app. Custom domains (app.zapidly.com) use Clerk DNS —
    // enabling /__clerk there causes host_invalid on handshake.
    const proxyUrl = clerkClientProxyUrl(req.nextUrl.hostname);
    return {
      ...(proxyUrl ? { proxyUrl } : {}),
      frontendApiProxy: {
        enabled: (url) => Boolean(clerkClientProxyUrl(url.hostname)),
      },
    };
  },
);

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (devAuthBypassEnabled() || !isClerkReady()) {
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
