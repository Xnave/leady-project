import { describe, expect, it } from "vitest";
import { rateLimit, tooManyRequests, type RateLimitStore } from "./rate-limit";

function memoryStore(): RateLimitStore & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async hit(key, windowStart) {
      const k = `${key}@${windowStart.toISOString()}`;
      const next = (counts.get(k) ?? 0) + 1;
      counts.set(k, next);
      return next;
    },
  };
}

const rule = { limit: 3, windowMs: 60_000 };

describe("rateLimit", () => {
  it("allows up to the limit, then blocks", async () => {
    const store = memoryStore();
    const now = Date.UTC(2026, 9, 6, 12, 0, 10);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit("t1:demo", rule, { store, now }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[2].remaining).toBe(0);
  });

  it("reports seconds until the window resets", async () => {
    const store = memoryStore();
    const now = Date.UTC(2026, 9, 6, 12, 0, 10);
    for (let i = 0; i < 3; i++) await rateLimit("t1:demo", rule, { store, now });
    const blocked = await rateLimit("t1:demo", rule, { store, now });
    expect(blocked.retryAfterSec).toBe(50);
  });

  it("starts a fresh count in the next window", async () => {
    const store = memoryStore();
    const now = Date.UTC(2026, 9, 6, 12, 0, 10);
    for (let i = 0; i < 4; i++) await rateLimit("t1:demo", rule, { store, now });
    const next = await rateLimit("t1:demo", rule, { store, now: now + 60_000 });
    expect(next.ok).toBe(true);
  });

  it("counts keys separately", async () => {
    const store = memoryStore();
    const now = Date.UTC(2026, 9, 6, 12, 0, 10);
    for (let i = 0; i < 4; i++) await rateLimit("t1:demo", rule, { store, now });
    expect((await rateLimit("t2:demo", rule, { store, now })).ok).toBe(true);
  });

  it("fails open when the store throws", async () => {
    const store: RateLimitStore = {
      hit: async () => {
        throw new Error("db down");
      },
    };
    expect((await rateLimit("t1:demo", rule, { store })).ok).toBe(true);
  });
});

describe("tooManyRequests", () => {
  it("answers 429 with Retry-After", async () => {
    const res = tooManyRequests({ ok: false, remaining: 0, retryAfterSec: 42 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });
});
