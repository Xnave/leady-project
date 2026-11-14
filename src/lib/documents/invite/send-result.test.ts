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
  it("treats account-wide 4xx (auth, rate limit) as blocked: the run stops, the contact is not burned", () => {
    for (const status of [401, 403, 429]) {
      expect(classifySendError(new ZernioApiError(status, { error: "x" })).kind).toBe("blocked");
    }
  });
  it("treats a 408 timeout as unknown: the send may have gone out", () => {
    expect(classifySendError(new ZernioApiError(408, { error: "timeout" })).kind).toBe("unknown");
  });
  it("treats 5xx and network failures as unknown, never retried", () => {
    expect(classifySendError(new ZernioApiError(503, { error: "busy" })).kind).toBe("unknown");
    expect(classifySendError(new TypeError("fetch failed"))).toEqual({ kind: "unknown", reason: "fetch failed" });
    expect(classifySendError("weird").kind).toBe("unknown");
  });
});
