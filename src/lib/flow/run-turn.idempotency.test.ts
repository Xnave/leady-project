import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primaryOutboundIdempotencyKey } from "./run-turn";

describe("primaryOutboundIdempotencyKey", () => {
  it("is stable per conversation + trigger (no text hash)", () => {
    expect(primaryOutboundIdempotencyKey("c1", "m1")).toBe("out-c1-m1");
    expect(primaryOutboundIdempotencyKey("c1", "m1")).toBe(
      primaryOutboundIdempotencyKey("c1", "m1"),
    );
  });

  it("runTurnNow wires sendAndSave to the stable key without text suffix", () => {
    const src = readFileSync(join(__dirname, "run-turn.ts"), "utf8");
    expect(src).toMatch(/idempotencyKey:\s*outboundKey/);
    expect(src).not.toMatch(
      /idempotencyKey:\s*outboundKey\s*\?\s*`\$\{outboundKey\}-\$\{Buffer\.from\(text\)/,
    );
  });
});
