import { afterEach, describe, expect, it, vi } from "vitest";
import { adminBypass, isAdminSession } from "@/lib/admin";
import { devAuthBypassEnabled, isProductionRuntime } from "@/lib/dev-auth-bypass";

vi.mock("@clerk/nextjs/server", () => ({ currentUser: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

describe("isProductionRuntime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false in local development", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isProductionRuntime()).toBe(false);
  });

  it("is true on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(isProductionRuntime()).toBe(true);
  });

  it("is true when NODE_ENV is production", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(true);
  });
});

describe("DEV_AUTH_BYPASS guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function local() {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_AUTH_BYPASS", "true");
  }

  it("is on locally when DEV_AUTH_BYPASS=true", () => {
    local();
    expect(devAuthBypassEnabled()).toBe(true);
    expect(adminBypass()).toBe(true);
  });

  it("is off when DEV_AUTH_BYPASS is not exactly true", () => {
    local();
    vi.stubEnv("DEV_AUTH_BYPASS", "1");
    expect(devAuthBypassEnabled()).toBe(false);
  });

  it("is off on Vercel even if DEV_AUTH_BYPASS=true", async () => {
    local();
    vi.stubEnv("VERCEL", "1");
    expect(devAuthBypassEnabled()).toBe(false);
    expect(adminBypass()).toBe(false);
    expect(await isAdminSession()).toBe(false);
  });

  it("is off in a production build even if DEV_AUTH_BYPASS=true", async () => {
    local();
    vi.stubEnv("NODE_ENV", "production");
    expect(devAuthBypassEnabled()).toBe(false);
    expect(adminBypass()).toBe(false);
    expect(await isAdminSession()).toBe(false);
  });
});
