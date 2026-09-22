import { describe, expect, it, vi, afterEach } from "vitest";
import { createZernioProfile, parseZernioInboxContact, parseZernioMessageReceived, zernioProfileName } from "./zernio";

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

  it("reads Instagram name and username from the sender", () => {
    const parsed = parseZernioMessageReceived({
      id: "evt-ig-name",
      event: "message.received",
      account: { id: "acc_ig", platform: "instagram" },
      conversation: { id: "conv-ig" },
      message: {
        id: "m-ig",
        conversationId: "conv-ig",
        platform: "instagram",
        platformMessageId: "mid.ig",
        direction: "incoming",
        text: "hi",
        sender: {
          id: "1634072858426706",
          name: "Jane",
          username: "jane_doe",
        },
      },
    });
    expect(parsed).toMatchObject({
      from: "1634072858426706",
      senderName: "Jane",
      senderUsername: "jane_doe",
      platform: "instagram",
    });
  });

  it("reads a username-only Instagram sender", () => {
    const parsed = parseZernioMessageReceived({
      id: "evt-ig-user",
      event: "message.received",
      account: { id: "acc_ig", platform: "instagram" },
      conversation: { id: "conv-ig" },
      message: {
        id: "m-ig2",
        conversationId: "conv-ig",
        direction: "incoming",
        text: "hi",
        sender: { name: "Jane", username: "jane_doe" },
      },
    });
    expect(parsed).toMatchObject({
      from: "jane_doe",
      senderName: "Jane",
      senderUsername: "jane_doe",
    });
  });

  it("extracts Instagram username from an inbox conversation", () => {
    expect(
      parseZernioInboxContact({
        data: {
          participantName: "Jane",
          participantUsername: "jane_doe",
          url: "https://instagram.com/jane_doe",
        },
      }),
    ).toMatchObject({ name: "Jane", username: "jane_doe" });
  });

  it("reads an inbound Instagram DM sender id", () => {
    const parsed = parseZernioMessageReceived({
      id: "evt-ig",
      event: "message.received",
      account: { id: "acc_ig", platform: "instagram" },
      conversation: { id: "conv-ig" },
      message: {
        id: "m-ig",
        conversationId: "conv-ig",
        platform: "instagram",
        platformMessageId: "mid.ig",
        direction: "incoming",
        text: "hi",
        sender: { id: "17841400000" },
      },
    });
    expect(parsed).toMatchObject({
      from: "17841400000",
      accountId: "acc_ig",
      platform: "instagram",
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

  it("ignores payloads with no inbound direction", () => {
    expect(
      parseZernioMessageReceived({
        event: "message.received",
        message: { text: "hi", sender: { id: "1" }, conversationId: "c1" },
      }),
    ).toBeNull();
  });
});
