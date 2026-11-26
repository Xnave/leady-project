import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

let role: "owner" | "admin" | "member" = "owner";
let addon = true;

vi.mock("@/lib/tenant-role", () => ({
  tenantRoleOr403: async (level: string) =>
    level === "manager" && role === "member"
      ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
      : { tenantId: "t1", role, platformAdmin: false },
}));
vi.mock("./store", () => ({ campaignsEnabled: async () => addon }));

const { campaignAccessOr403 } = await import("./route-gate");

describe("campaignAccessOr403", () => {
  it("lets owners and admins of a tenant with the add-on in", async () => {
    role = "admin";
    addon = true;
    expect(await campaignAccessOr403()).toMatchObject({ tenantId: "t1" });
  });

  it("rejects members", async () => {
    role = "member";
    const res = await campaignAccessOr403();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it("rejects everyone when the add-on is off", async () => {
    role = "owner";
    addon = false;
    const res = await campaignAccessOr403();
    expect((res as Response).status).toBe(403);
  });
});
