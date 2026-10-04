import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  platformAdmin: false,
  userId: "user_member" as string | null,
  orgRole: "org:member" as string | null,
  email: "member@example.com",
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.userId, orgRole: state.orgRole }),
  currentUser: async () => ({
    primaryEmailAddressId: "e1",
    emailAddresses: [{ id: "e1", emailAddress: state.email }],
  }),
  clerkClient: async () => ({}),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/admin", () => ({
  adminBypass: () => false,
  isAdminSession: async () => state.platformAdmin,
  primaryEmailFromClerkUser: async (u: { emailAddresses: { emailAddress: string }[] } | null) =>
    u?.emailAddresses[0]?.emailAddress ?? null,
}));
vi.mock("@/lib/tenant", () => ({
  requireTenantId: async () => "t1",
  requireTenantIdForPage: async () => "t1",
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: {
      findFirstOrThrow: async () => ({ ownerEmail: "owner@example.com", ownerClerkUserId: "user_owner" }),
    },
  },
}));

const {
  hasTenantAccess,
  requireTenantRole,
  requireTenantRoleForPage,
  tenantRoleOr403,
  TenantRoleForbidden,
} = await import("@/lib/tenant-role");

function as(who: "owner" | "admin" | "member" | "platform") {
  state.platformAdmin = who === "platform";
  state.userId = who === "owner" ? "user_owner" : who === "platform" ? "user_staff" : `user_${who}`;
  state.orgRole = who === "admin" ? "org:admin" : "org:member";
  state.email = `${who}@example.com`;
}

describe("tenant permission matrix", () => {
  const cases: [string, "owner" | "admin" | "member", boolean, Record<"member" | "manager" | "platform", boolean>][] = [
    ["member", "member", false, { member: true, manager: false, platform: false }],
    ["admin", "admin", false, { member: true, manager: true, platform: false }],
    ["owner", "owner", false, { member: true, manager: true, platform: false }],
    ["platform admin", "owner", true, { member: true, manager: true, platform: true }],
  ];
  for (const [label, role, platformAdmin, expected] of cases) {
    it(`${label}`, () => {
      for (const level of ["member", "manager", "platform"] as const) {
        expect(hasTenantAccess({ role, platformAdmin }, level)).toBe(expected[level]);
      }
    });
  }
});

describe("requireTenantRole", () => {
  beforeEach(() => as("member"));

  it("resolves the owner by Clerk user id", async () => {
    as("owner");
    await expect(requireTenantRole("manager")).resolves.toEqual({
      tenantId: "t1",
      role: "owner",
      platformAdmin: false,
    });
  });

  it("resolves an org admin as admin", async () => {
    as("admin");
    expect((await requireTenantRole("manager")).role).toBe("admin");
  });

  it("blocks a member from manager and platform routes", async () => {
    await expect(requireTenantRole("member")).resolves.toMatchObject({ role: "member" });
    await expect(requireTenantRole("manager")).rejects.toBeInstanceOf(TenantRoleForbidden);
    await expect(requireTenantRole("platform")).rejects.toBeInstanceOf(TenantRoleForbidden);
  });

  it("blocks the tenant owner from platform-only routes", async () => {
    as("owner");
    await expect(requireTenantRole("platform")).rejects.toBeInstanceOf(TenantRoleForbidden);
  });

  it("lets a platform admin through everything", async () => {
    as("platform");
    await expect(requireTenantRole("platform")).resolves.toMatchObject({ platformAdmin: true });
  });

  it("tenantRoleOr403 returns a 403 response instead of throwing", async () => {
    const res = await tenantRoleOr403("manager");
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it("page guard sends members home", async () => {
    await expect(requireTenantRoleForPage("manager")).rejects.toThrow("redirect:/");
  });
});

describe("config routes are role-gated", () => {
  const gated: [string, "manager" | "platform"][] = [
    ["ops/agent", "platform"],
    ["ops/preview", "platform"],
    ["tenant/capability-instances", "platform"],
    ["onboard", "manager"],
    ["onboard/extract", "manager"],
    ["hookmyapp/onboard", "manager"],
    ["hookmyapp/sync", "manager"],
    ["channels/zernio/connect", "manager"],
    ["channels/zernio/callback", "manager"],
  ];
  for (const [route, level] of gated) {
    it(`${route} requires ${level}`, () => {
      const src = readFileSync(path.join(process.cwd(), "src/app/api", route, "route.ts"), "utf8");
      expect(src).toContain(`tenantRoleOr403("${level}")`);
    });
  }
});
