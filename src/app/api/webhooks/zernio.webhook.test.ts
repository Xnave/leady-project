import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "zernio/route.ts"), "utf8");

describe("zernio webhook refresh policy", () => {
  it("does not refresh CRM on the happy-path after enqueue", () => {
    expect(src).not.toMatch(/after\s*\(\s*\(\)\s*=>\s*safeRefreshLeadState/);
    expect(src).toMatch(/enqueue_failed/);
    expect(src).toMatch(/safeRefreshLeadState/);
  });

  it("rejects in production when ZERNIO_WEBHOOK_SECRET is unset", () => {
    expect(src).toMatch(/isProductionRuntime/);
    expect(src).toMatch(/webhook secret not configured/);
    expect(src).toMatch(/status:\s*401/);
  });
});
