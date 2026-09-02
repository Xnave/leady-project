import { describe, expect, it } from "vitest";
import { redirectPath, requestOrigin } from "./request-url";

describe("requestOrigin", () => {
  it("prefers x-forwarded host behind a tunnel", () => {
    const req = new Request("http://localhost:3000/api/admin/impersonate", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "emphasis-anywhere-factory-stages.trycloudflare.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(requestOrigin(req)).toBe("https://emphasis-anywhere-factory-stages.trycloudflare.com");
    expect(redirectPath(req, "/leads").href).toBe(
      "https://emphasis-anywhere-factory-stages.trycloudflare.com/leads",
    );
  });

  it("falls back to localhost for local dev", () => {
    const req = new Request("http://localhost:3000/leads");
    expect(requestOrigin(req)).toBe("http://localhost:3000");
  });
});
