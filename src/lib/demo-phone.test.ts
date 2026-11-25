import { describe, expect, it } from "vitest";
import { demoPhoneSender, phoneFromDemoSender, replyStaysHere, senderPhone } from "./demo-phone";

describe("demo phone impersonation", () => {
  it("keeps the typed number behind a demo sender id", () => {
    expect(demoPhoneSender("052-659-5639")).toBe("demo-phone-0526595639");
    expect(demoPhoneSender("+972526595639")).toBe("demo-phone-972526595639");
    expect(demoPhoneSender("not a phone")).toBe("");
    expect(phoneFromDemoSender("demo-phone-0526595639")).toBe("0526595639");
    expect(phoneFromDemoSender("972501234567")).toBe("");
  });

  it("uses the incoming number ahead of a phone saved on the lead", () => {
    expect(senderPhone("demo-phone-0526595639", "0500000000")).toBe("0526595639");
    expect(senderPhone("+972501234567", "0500000000")).toBe("+972501234567");
    expect(senderPhone("1422526199846123", "0526595639")).toBe("0526595639");
  });

  it("holds delivery for an impersonated thread", () => {
    expect(replyStaysHere({ demoReplyHereOnly: "1" }, "0526595639")).toBe(true);
    expect(replyStaysHere({}, "demo-phone-0526595639")).toBe(true);
    expect(replyStaysHere({}, "972501234567")).toBe(false);
  });
});
