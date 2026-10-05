import { describe, expect, it } from "vitest";
import {
  bookingConfigFromFields,
  bookingInstance,
  parseBookingConfig,
} from "./booking-config";

describe("booking config venueSchedule", () => {
  it("normalizes schedule from the hours label on write", () => {
    const cfg = bookingConfigFromFields({
      venueHours: "א', ג', ה' 09:00-19:00 | ב', ד' 09:00-15:00 | שישי 09:00-13:00",
    });
    expect(cfg.venueSchedule).toEqual([
      { days: [0, 2, 4], open: "09:00", close: "19:00" },
      { days: [1, 3], open: "09:00", close: "15:00" },
      { days: [5], open: "09:00", close: "13:00" },
    ]);
  });

  it("rebuilds schedule from the label when legacy rows omit it", () => {
    const cfg = parseBookingConfig({
      venueAddress: "1 Main",
      venueHours: "Sun–Thu 09:00–19:00",
    });
    expect(cfg.venueSchedule).toEqual([
      { days: [0, 1, 2, 3, 4], open: "09:00", close: "19:00" },
    ]);
  });

  it("bookingInstance fills schedule from venueHours", () => {
    const snap = bookingInstance({ venueHours: "Fri 09:00-13:00" });
    expect(snap.config).toMatchObject({
      venueHours: "Fri 09:00-13:00",
      venueSchedule: [{ days: [5], open: "09:00", close: "13:00" }],
      timezone: "Asia/Jerusalem",
    });
  });

  it("defaults timezone to Asia/Jerusalem", () => {
    expect(bookingConfigFromFields({ venueHours: "9-17" }).timezone).toBe(
      "Asia/Jerusalem",
    );
    expect(parseBookingConfig({ venueHours: "9-17" }).timezone).toBe("Asia/Jerusalem");
  });
});
