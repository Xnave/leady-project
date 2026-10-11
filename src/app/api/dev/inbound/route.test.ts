import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("dev inbound route fallback", () => {
  it("sync runTurnNow only when enqueue fails", () => {
    const src = readFileSync(join(__dirname, "route.ts"), "utf8");
    expect(src).toMatch(/if\s*\(\s*!enqueued\s*\)/);
    expect(src).not.toMatch(/setTimeout\(r,\s*800\)/);
  });
});
