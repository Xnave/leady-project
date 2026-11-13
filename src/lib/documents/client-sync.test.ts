import { describe, expect, it } from "vitest";
import { matchesStoredPhone } from "./client-sync";

describe("matchesStoredPhone", () => {
  it("matches either borrower phone", () => {
    const row = { phone1: "0501111111", phone2: "0522222222" };
    expect(matchesStoredPhone(row, "+972501111111")).toBe(true);
    expect(matchesStoredPhone(row, "0522222222")).toBe(true);
    expect(matchesStoredPhone(row, "+972509999999")).toBe(false);
  });
});
