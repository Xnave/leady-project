import { ZernioApiError } from "@/lib/zernio";

export type SendFailure =
  | { kind: "rejected"; reason: string }
  | { kind: "blocked"; reason: string }
  | { kind: "unknown"; reason: string };

/** Account-wide refusals: nothing went out, and the next contact would fail the same way. */
const BLOCKED = new Set([401, 403, 429]);

/**
 * - `rejected`: Zernio/Meta refused this one message (a 4xx about the request or
 *   the number). Nothing went out; this contact is stopped.
 * - `blocked`: auth or rate limit. Nothing went out; the run stops and the
 *   contact is released for the next run.
 * - `unknown`: 408, 5xx, timeout or network. It may have gone out after the
 *   request left, so it is never retried: a second template is a second paid message.
 */
export function classifySendError(err: unknown): SendFailure {
  const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  if (err instanceof ZernioApiError) {
    if (BLOCKED.has(err.status)) return { kind: "blocked", reason };
    if (err.status >= 400 && err.status < 500 && err.status !== 408) return { kind: "rejected", reason };
  }
  return { kind: "unknown", reason };
}
