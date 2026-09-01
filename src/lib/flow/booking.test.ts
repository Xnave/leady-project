import { describe, expect, it } from "vitest";
import {
  bookingFieldGaps,
  extractTimePreference,
  extractVenueFromKnowledge,
  extractVisitKind,
  tentativeBookingMessage,
} from "./booking";

describe("booking helpers", () => {
  it("reads Wednesday 5pm as a slot", () => {
    expect(extractTimePreference("ברביעי ב5 אחרצ")).toMatch(/17:00|רביעי/);
  });

  it("treats coming in as a showroom visit", () => {
    expect(extractVisitKind("אני רוצה לבוא")).toBe("showroom");
  });

  it("asks for time then name then phone", () => {
    expect(bookingFieldGaps({})[0]).toBe("time_preference");
    expect(bookingFieldGaps({ time_preference: "רביעי 17:00" })[0]).toBe("name");
    expect(
      bookingFieldGaps({ time_preference: "רביעי 17:00", name: "נווה" })[0],
    ).toBe("phone");
    expect(
      bookingFieldGaps({
        time_preference: "רביעי 17:00",
        name: "נווה",
        phone: "0500000000",
      }),
    ).toEqual([]);
  });

  it("pulls address from knowledge and always includes it after a request", () => {
    const venue = extractVenueFromKnowledge(
      "שעות: א'-ה' 09:00-19:00\nכתובת: רחוב הרוגוזין 14, אזור התעשייה חולון",
    );
    expect(venue.address).toMatch(/הרוגוזין/);
    const msg = tentativeBookingMessage("he", {
      slot: "רביעי 17:00",
      address: venue.address,
      kind: "showroom",
    });
    expect(msg).toMatch(/ההזמנה נקלטה/);
    expect(msg).toMatch(/הרוגוזין/);
  });
});
