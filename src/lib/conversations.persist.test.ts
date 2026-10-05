import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "conversations.ts"), "utf8");
const persistFn = src.slice(
  src.indexOf("export async function persistInboundIfNew"),
  src.indexOf("export async function loadTurnContext"),
);

describe("persistInboundIfNew", () => {
  it("does not refresh CRM on the persist return path", () => {
    expect(persistFn).not.toMatch(/safeRefreshLeadState/);
  });

  it("bumps lastLeadMessageAt with the inbound message write", () => {
    expect(persistFn).toMatch(/lastLeadMessageAt/);
  });

  it("stays idempotent on providerMessageId", () => {
    expect(persistFn).toMatch(/tenantId_providerMessageId/);
    expect(persistFn).toMatch(/P2002/);
  });
});
