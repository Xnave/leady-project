import { describe, expect, it } from "vitest";
import { ZernioApiError } from "@/lib/zernio";
import { classifySendError } from "./send-result";

describe("classifySendError", () => {
  it("treats a 4xx from Zernio as a definite rejection", () => {
    expect(classifySendError(new ZernioApiError(400, { error: "not on WhatsApp" }))).toEqual({
      kind: "rejected",
      reason: "Zernio 400: not on WhatsApp",
    });
  });
  it("treats 5xx and network failures as unknown, never retried", () => {
    expect(classifySendError(new ZernioApiError(503, { error: "busy" })).kind).toBe("unknown");
    expect(classifySendError(new TypeError("fetch failed"))).toEqual({ kind: "unknown", reason: "fetch failed" });
    expect(classifySendError("weird").kind).toBe("unknown");
  });
});
