import { describe, expect, it } from "vitest";
import { clientWhere, parseClientFilters } from "./list";

describe("parseClientFilters", () => {
  it("reads known values and drops the rest", () => {
    expect(parseClientFilters({ q: " Dana ", confidence: "high", from: "2016", to: "2021", page: "2" })).toEqual({
      q: "Dana",
      confidence: "high",
      dealFrom: 2016,
      dealTo: 2021,
      page: 2,
    });
    expect(parseClientFilters({ confidence: "sure", from: "abc", page: "-1" })).toEqual({
      q: "",
      confidence: "",
      dealFrom: null,
      dealTo: null,
      page: 1,
    });
  });
});

describe("clientWhere", () => {
  it("always scopes to the tenant", () => {
    const where = clientWhere("t1", parseClientFilters({}));
    expect(where).toEqual({ AND: [{ tenantId: "t1" }] });
  });

  it("filters deal year as a whole-year range and searches phone digits", () => {
    const where = clientWhere("t1", parseClientFilters({ q: "050-12", from: "2016", to: "2018" }));
    expect(where.AND).toContainEqual({ dealDate: { gte: new Date("2016-01-01T00:00:00Z") } });
    expect(where.AND).toContainEqual({ dealDate: { lt: new Date("2019-01-01T00:00:00Z") } });
    expect(JSON.stringify(where)).toContain('"phone":{"contains":"5012"}');
  });
});
