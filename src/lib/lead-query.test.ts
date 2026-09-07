import { describe, expect, it } from "vitest";
import { leadFilterParams, leadWhere, parseLeadFilters } from "./lead-query";

describe("parseLeadFilters", () => {
  it("falls back to 'all' for unknown kind and status", () => {
    expect(parseLeadFilters({ kind: "bogus", status: "bogus" })).toEqual({
      q: "",
      kind: "all",
      status: "all",
    });
  });

  it("keeps known values and trims the query", () => {
    expect(parseLeadFilters({ q: "  dana ", kind: "live", status: "won" })).toEqual({
      q: "dana",
      kind: "live",
      status: "won",
    });
  });
});

describe("leadWhere", () => {
  it("searches captured contact fields as well as the lead row", () => {
    const where = leadWhere("t1", { q: "052", kind: "all", status: "all" });
    expect(where.tenantId).toBe("t1");
    expect(where.OR).toEqual([
      { displayName: { contains: "052", mode: "insensitive" } },
      { externalUserId: { contains: "052", mode: "insensitive" } },
      { fields: { path: ["phone"], string_contains: "052" } },
      { fields: { path: ["email"], string_contains: "052" } },
      { fields: { path: ["name"], string_contains: "052" } },
    ]);
  });

  it("folds legacy 'closed' rows into the lost filter", () => {
    expect(leadWhere("t1", { q: "", kind: "all", status: "lost" }).status).toEqual({
      in: ["lost", "closed"],
    });
  });

  it("scopes demo and live by the external id prefix", () => {
    expect(leadWhere("t1", { q: "", kind: "demo", status: "all" }).externalUserId).toEqual({
      startsWith: "demo-",
    });
    expect(leadWhere("t1", { q: "", kind: "live", status: "all" }).NOT).toEqual({
      externalUserId: { startsWith: "demo-" },
    });
  });

  it("omits default filters from the round-trip params", () => {
    expect(leadFilterParams({ q: "", kind: "all", status: "all" })).toEqual({});
    expect(leadFilterParams({ q: "a", kind: "live", status: "won" })).toEqual({
      q: "a",
      kind: "live",
      status: "won",
    });
  });
});
