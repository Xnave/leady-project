import { describe, expect, it } from "vitest";
import { looksLikePhoneNumber } from "./phone";
import { callbackPhone } from "./booking-collect";
import type { TurnContext } from "./types";

describe("looksLikePhoneNumber", () => {
  it("accepts local IL and E.164 mobiles", () => {
    expect(looksLikePhoneNumber("0526595639")).toBe(true);
    expect(looksLikePhoneNumber("052-659-5639")).toBe(true);
    expect(looksLikePhoneNumber("+972526595639")).toBe(true);
  });

  it("rejects Instagram-style PSIDs", () => {
    expect(looksLikePhoneNumber("1422526199846123")).toBe(false);
    expect(looksLikePhoneNumber("1634072858426706")).toBe(false);
  });
});

describe("callbackPhone", () => {
  it("does not treat Instagram external ids as phones", () => {
    const ctx = {
      lead: { id: "l1", externalUserId: "1422526199846123", fields: {} },
      channel: { provider: "instagram" as const, customerPhone: "1422526199846123" },
    } as TurnContext;
    expect(callbackPhone(ctx)).toBeUndefined();
  });

  it("uses WhatsApp sender id when it looks like a phone", () => {
    const ctx = {
      lead: { id: "l1", externalUserId: "+972501234567", fields: {} },
      channel: { provider: "whatsapp" as const },
    } as TurnContext;
    expect(callbackPhone(ctx)).toBe("+972501234567");
  });
});
