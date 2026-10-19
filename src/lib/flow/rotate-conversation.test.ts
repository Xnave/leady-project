import { describe, expect, it } from "vitest";
import { clearEndedThreadLeadFields } from "./rotate-conversation";

describe("clearEndedThreadLeadFields", () => {
  it("drops the visit note and booking drafts and keeps name and phone", () => {
    const next = clearEndedThreadLeadFields({
      name: "Dana",
      phone: "+1",
      interest: "meniscus tear",
      need: "meniscus tear",
      time_preference: "Thu 15:00",
      booking_confirm: "confirmed",
    });
    expect(next).toEqual({ name: "Dana", phone: "+1" });
  });
});
