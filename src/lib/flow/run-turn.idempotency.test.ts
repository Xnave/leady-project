import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { primaryOutboundIdempotencyKey, turnTasksSince } from "./run-turn";

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

describe("turnTasksSince", () => {
  it("uses the caller's anchor when given, else the worker start", () => {
    expect(turnTasksSince({ tasksSince: 1_000 }, 5_000)).toEqual(new Date(1_000));
    expect(turnTasksSince({}, 5_000)).toEqual(new Date(5_000));
  });

  it("runTurnNow matches tasks from it, and the HITL resume passes a stable anchor", () => {
    const src = readFileSync(join(__dirname, "run-turn.ts"), "utf8");
    expect(src.match(/since: turnTasksSince\(opts, started\)/g)).toHaveLength(2);
    const route = readFileSync(join(__dirname, "../../app/api/hitl/[id]/complete/route.ts"), "utf8");
    expect(route).toMatch(/resume: true,\s*tasksSince,/);
  });
});
