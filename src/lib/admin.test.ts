import { describe, expect, it, afterEach } from "vitest";
import { isPlatformAdminEmail, platformAdminEmails } from "@/lib/admin";
import { clerkRoleForInvite, normalizeEmail } from "@/lib/org-roles";

describe("platform admin allowlist", () => {
  const prev = process.env.PLATFORM_ADMIN_EMAILS;

  afterEach(() => {
    if (prev === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = prev;
  });

  it("defaults to the two platform emails", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    const set = platformAdminEmails();
    expect(set.has("naveine97@gmail.com")).toBe(true);
    expect(set.has("snir.ai.solutions@gmail.com")).toBe(true);
  });

  it("respects PLATFORM_ADMIN_EMAILS override", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "a@example.com, B@Example.COM";
    expect(isPlatformAdminEmail("a@example.com")).toBe(true);
    expect(isPlatformAdminEmail("b@example.com")).toBe(true);
    expect(isPlatformAdminEmail("naveine97@gmail.com")).toBe(false);
  });
});

describe("org roles", () => {
  it("normalizes email", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });

  it("maps invite roles to Clerk keys", () => {
    expect(clerkRoleForInvite("admin")).toBe("org:admin");
    expect(clerkRoleForInvite("member")).toBe("org:member");
  });
});
