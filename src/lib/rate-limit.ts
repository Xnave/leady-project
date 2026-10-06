import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Fixed-window rate limiter backed by Postgres (`RateLimitBucket`), so it holds across
 * serverless instances without a Redis dependency. One upsert per limited request.
 *
 * Keys are caller-chosen and should include the tenant, e.g. `demo:${tenantId}`.
 */

export type RateLimitRule = { limit: number; windowMs: number };

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };

export type RateLimitStore = {
  /** Increment the counter for (key, windowStart) and return the new count. */
  hit(key: string, windowStart: Date): Promise<number>;
};

export const RATE_LIMITS = {
  /** Demo chat: each message runs a full LLM turn. */
  demoMessage: { limit: 20, windowMs: 60_000 },
  /** Onboarding document extraction: one large LLM call per request. */
  onboardExtract: { limit: 10, windowMs: 10 * 60_000 },
} satisfies Record<string, RateLimitRule>;

/** Buckets older than this are deleted on the next hit for the same key. */
const RETAIN_MS = 24 * 60 * 60_000;

export const prismaRateLimitStore: RateLimitStore = {
  async hit(key, windowStart) {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key", "windowStart")
      DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"`;
    const count = Number(rows[0]?.count ?? 1);
    if (count === 1) {
      // First hit of a new window: drop this key's stale buckets so the table stays small.
      await prisma.rateLimitBucket.deleteMany({
        where: { key, windowStart: { lt: new Date(windowStart.getTime() - RETAIN_MS) } },
      });
    }
    return count;
  },
};

export async function rateLimit(
  key: string,
  rule: RateLimitRule,
  opts: { store?: RateLimitStore; now?: number } = {},
): Promise<RateLimitResult> {
  const store = opts.store ?? prismaRateLimitStore;
  const now = opts.now ?? Date.now();
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const retryAfterSec = Math.ceil((windowStart + rule.windowMs - now) / 1000);
  let count: number;
  try {
    count = await store.hit(key, new Date(windowStart));
  } catch (err) {
    // A limiter outage must not take the route down with it.
    console.error(JSON.stringify({ msg: "rate_limit.store_failed", key, error: String(err) }));
    return { ok: true, remaining: rule.limit, retryAfterSec: 0 };
  }
  const ok = count <= rule.limit;
  if (!ok) console.warn(JSON.stringify({ msg: "rate_limit.blocked", key, count, limit: rule.limit }));
  return { ok, remaining: Math.max(0, rule.limit - count), retryAfterSec };
}

/** `error` is shown to the operator as-is; pass localized UI copy. */
export function tooManyRequests(result: RateLimitResult, error = "Too many requests"): NextResponse {
  return NextResponse.json(
    { error, retryAfterSec: result.retryAfterSec },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
  );
}
