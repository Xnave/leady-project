/** Build the public origin for redirects behind nginx / reverse proxies. */
export function requestOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto");

  const host = forwardedHost?.split(",")[0]?.trim() || hostHeader?.trim();
  if (host) {
    const proto =
      forwardedProto?.split(",")[0]?.trim() ||
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }

  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (configured) return configured;

  return new URL(req.url).origin;
}

export function redirectPath(req: Request, pathname: string): URL {
  return new URL(pathname, requestOrigin(req));
}

/**
 * Where a settings form (UI language, appearance) should send the user after a
 * POST: back to the page they submitted from.
 *
 * `referer` cannot be used raw. It is absent under a no-referrer policy, which
 * made `NextResponse.redirect("/")` throw ERR_INVALID_URL (it requires an
 * absolute URL), and a cross-site POST could otherwise bounce the user to an
 * attacker's origin. So: same-origin referer, else the app root.
 */
export function refererRedirect(req: Request): URL {
  const origin = requestOrigin(req);
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer, origin);
      if (url.origin === origin) return url;
    } catch {
      // malformed referer - fall through to the app root
    }
  }
  return redirectPath(req, "/");
}

/**
 * Public app origin for invite redirects, OAuth callbacks, etc.
 * On Vercel, prefer the deployment host so a stale ngrok NEXT_PUBLIC_APP_URL
 * never becomes the Clerk invitation redirectUrl (that returns 400).
 */
export function appOrigin(): string {
  if (process.env.VERCEL) {
    const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").replace(/\/$/, "");
    if (prod) return prod.startsWith("http") ? prod : `https://${prod}`;
    const deploy = (process.env.VERCEL_URL ?? "").replace(/\/$/, "");
    if (deploy) return deploy.startsWith("http") ? deploy : `https://${deploy}`;
  }
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (configured) return configured;
  return "http://localhost:3000";
}
