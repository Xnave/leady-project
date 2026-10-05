import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn(async () => ({ userId: "u1", orgId: "o1", orgRole: "admin" }));
const currentUser = vi.fn(async () => ({ id: "u1" }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => auth(),
  currentUser: () => currentUser(),
}));

describe("getClerkAuth / getClerkUser", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    auth.mockClear();
    currentUser.mockClear();
  });

  it("does not call Clerk when keys are missing", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_AUTH_BYPASS", "true");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    const { getClerkAuth, getClerkUser } = await import("@/lib/clerk-auth");
    expect(await getClerkAuth()).toEqual({ userId: null, orgId: null, orgRole: null });
    expect(await getClerkUser()).toBeNull();
    expect(auth).not.toHaveBeenCalled();
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("calls Clerk when both keys are set", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_x");
    const { getClerkAuth, getClerkUser } = await import("@/lib/clerk-auth");
    expect(await getClerkAuth()).toEqual({ userId: "u1", orgId: "o1", orgRole: "admin" });
    expect(await getClerkUser()).toEqual({ id: "u1" });
    expect(auth).toHaveBeenCalledOnce();
    expect(currentUser).toHaveBeenCalledOnce();
  });
});
