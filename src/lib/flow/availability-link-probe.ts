import {
  renderReservationTemplate,
  type LinkProbeConfig,
  type LinkProbeMatcher,
} from "./reservation-config";

export type AvailabilityStatus = "available" | "unavailable" | "unknown";

export type LinkProbeResult = {
  status: AvailabilityStatus;
  url: string;
  matched?: string;
  error?: string;
};

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1|0\.0\.0\.0)/i;

function matcherHits(body: string, matchers: LinkProbeMatcher[]): string | undefined {
  const lower = body.toLowerCase();
  for (const m of matchers) {
    const needle = m.value.trim().toLowerCase();
    if (needle && lower.includes(needle)) return m.value;
  }
  return undefined;
}

/** Reject obviously unsafe probe targets (SSRF hygiene). */
export function assertSafeProbeUrl(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("invalid_probe_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("invalid_probe_protocol");
  }
  if (PRIVATE_HOST.test(url.hostname) || url.hostname.endsWith(".local")) {
    throw new Error("probe_host_blocked");
  }
  return url;
}

export function buildProbeUrl(
  config: LinkProbeConfig,
  vars: Record<string, string>,
): string {
  const merged = { ...(config.vars ?? {}), ...vars };
  return renderReservationTemplate(config.urlTemplate, merged);
}

/**
 * Classify page body against configured matchers.
 * Unavailable wins over available; neither → unknown.
 */
export function classifyProbeBody(
  body: string,
  config: Pick<LinkProbeConfig, "unavailableMatchers" | "availableMatchers">,
): { status: AvailabilityStatus; matched?: string } {
  const unavail = matcherHits(body, config.unavailableMatchers);
  if (unavail) return { status: "unavailable", matched: unavail };
  if (config.availableMatchers?.length) {
    const avail = matcherHits(body, config.availableMatchers);
    if (avail) return { status: "available", matched: avail };
  }
  return { status: "unknown" };
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/**
 * HTTP GET a configured booking calendar URL and classify availability from body text.
 * Config (URL template + matchers) is the source of truth — not a vendor SDK.
 */
export async function probeAvailabilityLink(opts: {
  config: LinkProbeConfig;
  vars: Record<string, string>;
  fetchFn?: FetchFn;
}): Promise<LinkProbeResult> {
  let url: string;
  try {
    url = buildProbeUrl(opts.config, opts.vars);
    assertSafeProbeUrl(url);
  } catch (err) {
    return {
      status: "unknown",
      url: "",
      error: err instanceof Error ? err.message : "invalid_url",
    };
  }

  const timeoutMs = opts.config.timeoutMs ?? 8_000;
  const fetchFn = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "LeadyAvailabilityProbe/1.0",
      },
    });
    const body = await res.text();
    if (!res.ok) {
      return { status: "unknown", url, error: `http_${res.status}` };
    }
    const classified = classifyProbeBody(body, opts.config);
    return { ...classified, url };
  } catch (err) {
    return {
      status: "unknown",
      url,
      error: err instanceof Error ? err.message : "fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
