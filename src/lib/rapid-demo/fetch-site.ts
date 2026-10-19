import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { isBlockedHostname, isIpLiteral, isPublicIpAddress, htmlToText } from "./guards";

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 8_000;

export type FetchSiteResult =
  | { ok: true; text: string; host: string }
  | { ok: false; error: "invalid_url" | "fetch_failed" };

export function publicSiteHost(raw: string): string | null {
  const url = parsePublicHttpsUrl(raw);
  if (!url) return null;
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

export function parsePublicHttpsUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return null;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (isBlockedHostname(url.hostname)) return null;
  return url;
}

/**
 * Every address must be public. Returns one of them so the later connection
 * can pin to that IP instead of resolving the name again (DNS rebinding).
 */
export function selectPublicAddress(addresses: string[]): string | null {
  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) return null;
  return addresses[0] ?? null;
}

/**
 * undici calls `lookup` again when it connects. Ignore the hostname it passes
 * and answer with the address `selectPublicAddress` already allowed.
 */
export function lookupPinnedTo(address: string) {
  const family = address.includes(":") ? 6 : 4;
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void,
  ) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

async function vettedAddress(hostname: string): Promise<string | null> {
  if (isIpLiteral(hostname)) return isPublicIpAddress(hostname) ? hostname : null;
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return null;
  }
  return selectPublicAddress(records.map((record) => record.address));
}

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > MAX_BYTES ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function acceptableType(contentType: string | null): boolean {
  if (!contentType) return true;
  const type = contentType.toLowerCase();
  return /text\/|xml|json|html|markdown/.test(type);
}

export async function fetchPublicSite(rawUrl: string): Promise<FetchSiteResult> {
  const requestedHost = publicSiteHost(rawUrl);
  let current = parsePublicHttpsUrl(rawUrl);
  if (!current || !requestedHost) return { ok: false, error: "invalid_url" };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const address = await vettedAddress(current.hostname);
    if (!address) return { ok: false, error: "invalid_url" };
    const dispatcher = new Agent({
      connect: {
        ...(isIpLiteral(current.hostname) ? {} : { servername: current.hostname }),
        lookup: lookupPinnedTo(address),
      },
    });
    try {
      const res = await undiciFetch(current, {
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/html, text/plain;q=0.9, */*;q=0.1" },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location || hop === MAX_REDIRECTS) return { ok: false, error: "fetch_failed" };
        const next = parsePublicHttpsUrl(new URL(location, current).toString());
        if (!next) return { ok: false, error: "invalid_url" };
        current = next;
        continue;
      }

      if (!res.ok) return { ok: false, error: "fetch_failed" };
      if (!acceptableType(res.headers.get("content-type"))) return { ok: false, error: "fetch_failed" };
      const body = await readCapped(res as unknown as Response);
      if (!body) return { ok: false, error: "fetch_failed" };
      const text = htmlToText(body);
      if (text.length < 20) return { ok: false, error: "fetch_failed" };
      return { ok: true, text, host: requestedHost };
    } catch {
      return { ok: false, error: "fetch_failed" };
    } finally {
      await dispatcher.close();
    }
  }
  return { ok: false, error: "fetch_failed" };
}
