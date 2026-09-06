import { describe, expect, it } from "vitest";
import { redirectPath, refererRedirect, requestOrigin } from "./request-url";

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

describe("refererRedirect", () => {
  function post(headers: Record<string, string>) {
    return new Request("http://localhost:3000/api/ui/theme", { method: "POST", headers });
  }

  it("returns to a same-origin referer", () => {
    const req = post({ host: "localhost:3000", referer: "http://localhost:3000/demo?leadId=abc" });
    expect(refererRedirect(req).href).toBe("http://localhost:3000/demo?leadId=abc");
  });

  it("falls back to an absolute root when there is no referer", () => {
    const req = post({ host: "localhost:3000" });
    expect(refererRedirect(req).href).toBe("http://localhost:3000/");
  });

  it("refuses to bounce to another origin", () => {
    const req = post({ host: "localhost:3000", referer: "https://evil.example.com/x" });
    expect(refererRedirect(req).href).toBe("http://localhost:3000/");
  });

  it("ignores a malformed referer", () => {
    const req = post({ host: "localhost:3000", referer: "http://[" });
    expect(refererRedirect(req).href).toBe("http://localhost:3000/");
  });
});
