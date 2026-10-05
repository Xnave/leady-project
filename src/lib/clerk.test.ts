import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clerkClientProxyUrl,
  isClerkReady,
  shouldProxyClerkFrontendApi,
} from "@/lib/clerk";

describe("Clerk env helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isClerkReady requires both keys", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    expect(isClerkReady()).toBe(false);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_x");
    expect(isClerkReady()).toBe(true);
  });

  it("does not infer proxy from VERCEL alone (custom domains deploy on Vercel too)", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "https://leady-project.vercel.app/__clerk");
    expect(clerkClientProxyUrl()).toBeUndefined();
    expect(clerkClientProxyUrl("app.zapidly.com")).toBeUndefined();
  });

  it("keeps a relative env proxy only when host is unknown", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "/__clerk");
    expect(clerkClientProxyUrl()).toBe("/__clerk");
    expect(clerkClientProxyUrl("app.zapidly.com")).toBeUndefined();
  });

  it("ignores absolute NEXT_PUBLIC_CLERK_PROXY_URL on custom domains", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "https://example.com/__clerk");
    expect(clerkClientProxyUrl("app.zapidly.com")).toBeUndefined();
  });

  it("proxies Clerk FAPI on vercel.app hosts, including preview URLs", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "https://leady-project.vercel.app/__clerk");
    expect(shouldProxyClerkFrontendApi("leady-project.vercel.app")).toBe(true);
    expect(shouldProxyClerkFrontendApi("leady-project-git-staging.vercel.app")).toBe(true);
    expect(clerkClientProxyUrl("leady-project-git-staging.vercel.app")).toBe("/__clerk");
    expect(shouldProxyClerkFrontendApi("app.zapidly.com")).toBe(false);
  });
});
