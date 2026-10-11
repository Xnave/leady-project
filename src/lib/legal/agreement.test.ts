import { describe, expect, it } from "vitest";
import { mustAcceptAgreement } from "@/lib/legal/agreement";

describe("mustAcceptAgreement", () => {
  it("asks only the owner, and only until they accept", () => {
    expect(mustAcceptAgreement({ platformAdmin: false, role: "owner", accepted: false })).toBe(true);
    expect(mustAcceptAgreement({ platformAdmin: false, role: "owner", accepted: true })).toBe(false);
  });

  it("never asks team members or platform staff", () => {
    expect(mustAcceptAgreement({ platformAdmin: false, role: "admin", accepted: false })).toBe(false);
    expect(mustAcceptAgreement({ platformAdmin: false, role: "member", accepted: false })).toBe(false);
    expect(mustAcceptAgreement({ platformAdmin: true, role: "owner", accepted: false })).toBe(false);
  });
});
