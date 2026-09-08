import { describe, expect, it } from "vitest";
import {
  leadFilterParams,
  leadWhere,
  parseLeadFilters,
  rangeStart,
  type LeadFilters,
} from "./lead-query";

const base: LeadFilters = { q: "", kind: "all", status: "all", range: "all" };
const NOW = new Date("2026-09-07T14:30:00");

describe("parseLeadFilters", () => {
  it("falls back to 'all' for unknown values", () => {
    expect(parseLeadFilters({ kind: "bogus", status: "bogus", range: "bogus" })).toEqual(base);
  });

  it("keeps known values and trims the query", () => {
    expect(parseLeadFilters({ q: "  dana ", kind: "live", status: "won", range: "7d" })).toEqual({
      q: "dana",
      kind: "live",
      status: "won",
      range: "7d",
    });
  });
});

describe("rangeStart", () => {
  it("returns null for the unbounded range", () => {
    expect(rangeStart("all", NOW)).toBeNull();
  });

  it("starts at midnight today", () => {
    expect(rangeStart("today", NOW)?.toISOString()).toBe(
      new Date("2026-09-07T00:00:00").toISOString(),
    );
  });

  it("counts the current day as one of the seven", () => {
    expect(rangeStart("7d", NOW)?.toISOString()).toBe(
      new Date("2026-09-01T00:00:00").toISOString(),
    );
  });

  it("counts the current day as one of the thirty", () => {
    expect(rangeStart("30d", NOW)?.toISOString()).toBe(
      new Date("2026-08-09T00:00:00").toISOString(),
    );
  });
});

describe("leadWhere", () => {
  it("scopes to the tenant with no clauses when nothing is filtered", () => {
    expect(leadWhere("t1", base, NOW)).toEqual({ tenantId: "t1" });
  });

  it("searches captured contact fields as well as the lead row", () => {
    const where = leadWhere("t1", { ...base, q: "052" }, NOW);
    expect(where.AND).toEqual([
      {
        OR: [
          { displayName: { contains: "052", mode: "insensitive" } },
          { externalUserId: { contains: "052", mode: "insensitive" } },
          { fields: { path: ["phone"], string_contains: "052" } },
          { fields: { path: ["email"], string_contains: "052" } },
          { fields: { path: ["name"], string_contains: "052" } },
        ],
      },
    ]);
  });

  it("composes search and date range instead of overwriting either", () => {
    const where = leadWhere("t1", { ...base, q: "dana", range: "today" }, NOW);
    expect(where.AND).toHaveLength(2);
    expect(where.AND).toContainEqual({
      updatedAt: { gte: new Date("2026-09-07T00:00:00") },
    });
  });

  it("folds legacy 'closed' rows into the lost filter", () => {
    expect(leadWhere("t1", { ...base, status: "lost" }, NOW).AND).toContainEqual({
      status: { in: ["lost", "closed"] },
    });
  });

  it("scopes demo and live by the external id prefix", () => {
    expect(leadWhere("t1", { ...base, kind: "demo" }, NOW).AND).toContainEqual({
      externalUserId: { startsWith: "demo-" },
    });
    expect(leadWhere("t1", { ...base, kind: "live" }, NOW).AND).toContainEqual({
      NOT: { externalUserId: { startsWith: "demo-" } },
    });
  });

  it("omits default filters from the round-trip params", () => {
    expect(leadFilterParams(base)).toEqual({});
    expect(leadFilterParams({ q: "a", kind: "live", status: "won", range: "30d" })).toEqual({
      q: "a",
      kind: "live",
      status: "won",
      range: "30d",
    });
  });
});
