import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("demo message route fallback", () => {
  it("sync runTurnNow only when enqueue fails, not on inngest timeout", () => {
    const src = readFileSync(join(__dirname, "route.ts"), "utf8");
    expect(src).toMatch(/inngest_unreachable/);
    expect(src).toMatch(/demo\.turn\.inngest_timeout/);
    expect(src).toMatch(/No sync runTurnNow/);
    // Timeout path must not call runTurnNow — only the !enqueued branch should.
    const timeoutBlock = src.slice(
      src.indexOf("demo.turn.inngest_timeout"),
      src.indexOf("inngest_unreachable"),
    );
    expect(timeoutBlock).not.toMatch(/runTurnNow\(/);
  });
});
