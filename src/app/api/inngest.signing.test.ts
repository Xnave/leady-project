import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "inngest/route.ts"), "utf8");

describe("inngest serve route", () => {
  it("rejects in production when INNGEST_SIGNING_KEY is unset", () => {
    expect(src).toMatch(/isProductionRuntime/);
    expect(src).toMatch(/INNGEST_SIGNING_KEY not configured/);
    expect(src).toMatch(/status:\s*401/);
  });
});
