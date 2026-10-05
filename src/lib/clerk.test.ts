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

  it("uses a relative proxy on Vercel so preview hosts are not pinned to production", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "https://leady-project.vercel.app/__clerk");
    expect(clerkClientProxyUrl()).toBe("/__clerk");
  });

  it("keeps a relative env proxy off Vercel", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "/__clerk");
    expect(clerkClientProxyUrl()).toBe("/__clerk");
  });

  it("strips an absolute proxy URL down to the path off Vercel", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "https://example.com/__clerk");
    expect(clerkClientProxyUrl()).toBe("/__clerk");
  });

  it("proxies Clerk FAPI on vercel.app hosts, including preview URLs", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PROXY_URL", "https://leady-project.vercel.app/__clerk");
    expect(shouldProxyClerkFrontendApi("leady-project.vercel.app")).toBe(true);
    expect(shouldProxyClerkFrontendApi("leady-project-git-staging.vercel.app")).toBe(true);
    expect(clerkClientProxyUrl("leady-project-git-staging.vercel.app")).toBe("/__clerk");
  });
});
