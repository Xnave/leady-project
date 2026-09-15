import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, redirectPath, refererRedirect, requestOrigin } from "./request-url";

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

describe("appOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Vercel production URL over a stale NEXT_PUBLIC_APP_URL", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "leady-project.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://stale.ngrok-free.app");
    expect(appOrigin()).toBe("https://leady-project.vercel.app");
  });

  it("falls back to NEXT_PUBLIC_APP_URL locally", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tunnel.example.com");
    expect(appOrigin()).toBe("https://tunnel.example.com");
  });
});
