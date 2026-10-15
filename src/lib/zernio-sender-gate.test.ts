import { describe, expect, it } from "vitest";
import { shouldHandleZernioSender, zernioGateMode, zernioSenderKey } from "./zernio-sender-gate";

describe("zernioSenderKey", () => {
  it("strips phone formatting to digits", () => {
    expect(zernioSenderKey("+972 50-123-4567")).toBe("972501234567");
    expect(zernioSenderKey("972501234567")).toBe("972501234567");
  });

  it("keeps instagram usernames as lowercase text", () => {
    expect(zernioSenderKey("@Studio.Name")).toBe("studio.name");
  });
});

describe("zernioGateMode", () => {
  it("handles everyone locally, pauses on production, and allow-lists other Vercel deploys", () => {
    expect(zernioGateMode({})).toBe("handle-all");
    expect(zernioGateMode({ vercel: "1", vercelEnv: "production" })).toBe("pause");
    expect(zernioGateMode({ vercel: "1", vercelEnv: "preview" })).toBe("allow");
  });
});

describe("shouldHandleZernioSender", () => {
  const gates = ["+972 50-123-4567", "@Studio.Name"];

  it("ignores the list on local", () => {
    expect(shouldHandleZernioSender("anyone", gates, "handle-all")).toBe(true);
  });

  it("pauses listed senders on production and still handles everyone else", () => {
    expect(shouldHandleZernioSender("972501234567", gates, "pause")).toBe(false);
    expect(shouldHandleZernioSender("+1 555 0100", gates, "pause")).toBe(true);
    expect(shouldHandleZernioSender("studio.name", gates, "pause")).toBe(false);
  });

  it("replies only to listed senders on preview, including when the list is empty", () => {
    expect(shouldHandleZernioSender("+972501234567", gates, "allow")).toBe(true);
    expect(shouldHandleZernioSender("+15550100", gates, "allow")).toBe(false);
    expect(shouldHandleZernioSender("+972501234567", [], "allow")).toBe(false);
    expect(shouldHandleZernioSender("", gates, "allow")).toBe(false);
  });
});
