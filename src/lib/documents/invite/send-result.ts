import { ZernioApiError } from "@/lib/zernio";

export type SendFailure = { kind: "rejected"; reason: string } | { kind: "unknown"; reason: string };

/**
 * A 4xx means Zernio/Meta refused the send: nothing went out. Anything else
 * (5xx, timeout, network) may have gone out after the request left, so it is
 * never retried: a second template is a second paid message.
 */
export function classifySendError(err: unknown): SendFailure {
  const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  if (err instanceof ZernioApiError && err.status >= 400 && err.status < 500) return { kind: "rejected", reason };
  return { kind: "unknown", reason };
}
