import { afterEach, describe, expect, it, vi } from "vitest";
import { adminBypass, isAdminSession } from "@/lib/admin";
import { devAuthBypassEnabled } from "@/lib/dev-auth-bypass";

vi.mock("@clerk/nextjs/server", () => ({ currentUser: async () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

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
