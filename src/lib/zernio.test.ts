import { describe, expect, it, vi, afterEach } from "vitest";
import { createZernioProfile, parseZernioMessageReceived, zernioProfileName } from "./zernio";

describe("zernioProfileName", () => {
  it("includes tenant id suffix for uniqueness", () => {
    expect(zernioProfileName("Acme Spa", "tenant-abc12345")).toBe("Acme Spa · tenant-a");
  });
});

describe("createZernioProfile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZERNIO_API_KEY;
  });

  it("reuses existing profile id on name conflict", async () => {
    process.env.ZERNIO_API_KEY = "sk_test_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({
              error: "A profile with this name already exists",
              code: "profile_name_conflict",
              details: { existingProfileId: "6a96d580da6b6eb49e827f67" },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    await expect(createZernioProfile("Acme · tenant-a")).resolves.toBe("6a96d580da6b6eb49e827f67");
  });
});

describe("parseZernioMessageReceived", () => {
  it("reads an inbound WhatsApp DM", () => {
    const parsed = parseZernioMessageReceived({
      id: "evt-1",
      event: "message.received",
      account: { id: "acc_sandbox", platform: "whatsapp" },
      conversation: { id: "conv-9" },
      message: {
        id: "m-1",
        conversationId: "conv-9",
        platform: "whatsapp",
        platformMessageId: "wamid.abc",
        direction: "incoming",
        text: "שלום",
        sender: { id: "972501234567", phoneNumber: "+972501234567" },
      },
    });
    expect(parsed).toMatchObject({
      from: "+972501234567",
      text: "שלום",
      conversationId: "conv-9",
      accountId: "acc_sandbox",
      platformMessageId: "wamid.abc",
    });
  });

  it("ignores outgoing echoes", () => {
    expect(
      parseZernioMessageReceived({
        event: "message.received",
        message: { direction: "outgoing", text: "hi", sender: { id: "1" } },
      }),
    ).toBeNull();
  });
});
