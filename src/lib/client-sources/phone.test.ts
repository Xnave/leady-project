import { describe, expect, it } from "vitest";
import { normalizeClientPhone } from "./phone";

describe("normalizeClientPhone", () => {
  it("turns Israeli local and international forms into digits with 972", () => {
    for (const raw of ["050-1234567", "0501234567", "+972 50 123 4567", "972501234567", "00972501234567", "501234567"]) {
      expect(normalizeClientPhone(raw, "972")).toEqual({ phone: "972501234567", status: "ok" });
    }
  });

  it("keeps landlines and foreign numbers", () => {
    expect(normalizeClientPhone("03-1234567", "972").phone).toBe("97231234567");
    expect(normalizeClientPhone("+1 415 555 0100", "972").phone).toBe("14155550100");
  });

  it("separates missing from invalid", () => {
    expect(normalizeClientPhone("", "972").status).toBe("missing");
    expect(normalizeClientPhone(null, "972").status).toBe("missing");
    expect(normalizeClientPhone("123", "972").status).toBe("invalid");
    expect(normalizeClientPhone("n/a", "972").status).toBe("invalid");
    expect(normalizeClientPhone("+972 0501234567", "972").status).toBe("invalid");
  });
});
