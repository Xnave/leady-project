import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isClerkConfigured } from "@/lib/clerk";

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

function authBypass(): boolean {
  return process.env.DEV_AUTH_BYPASS === "true";
}

export default clerkMiddleware(async (auth, req) => {
  if (authBypass() || !isClerkConfigured()) {
    return NextResponse.next();
  }
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }
  await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
