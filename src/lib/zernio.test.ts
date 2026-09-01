import { describe, expect, it } from "vitest";
import { parseZernioMessageReceived } from "./zernio";

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
