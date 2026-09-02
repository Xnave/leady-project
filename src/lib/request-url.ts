/** Build the public origin for redirects behind Cloudflare / reverse proxies. */
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

export function appOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return configured || "http://localhost:3000";
}
