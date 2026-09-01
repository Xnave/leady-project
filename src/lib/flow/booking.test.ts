import { describe, expect, it } from "vitest";
import { bookingFieldGaps } from "./booking";
import { copyFor, fillTemplate } from "@/lib/copy";

describe("booking helpers", () => {
  it("asks for time then name then need by default", () => {
    expect(bookingFieldGaps({})[0]).toBe("time_preference");
    expect(bookingFieldGaps({ time_preference: "Thursday 18:00" })[0]).toBe("name");
    expect(
      bookingFieldGaps({ time_preference: "Thursday 18:00", name: "Nave" })[0],
    ).toBe("need");
    expect(
      bookingFieldGaps({
        time_preference: "Thursday 18:00",
        name: "Nave",
        need: "product demo",
      }),
    ).toEqual([]);
  });

  it("only asks for phone when that field is required", () => {
    expect(
      bookingFieldGaps(
        { time_preference: "Thursday 18:00", name: "Nave" },
        ["time_preference", "name", "phone"],
      )[0],
    ).toBe("phone");
  });

  it("fills booking templates and drops empty labeled lines", () => {
    const text = fillTemplate(copyFor("en").chat.bookingRequestTemplate, {
      slot: "Thu 18:00",
      kind: "visit",
      need: "quote",
      name: "Dana",
      phone: "",
      email: "",
      address: "1 Main St",
      hours: "",
    });
    expect(text).toMatch(/Thu 18:00/);
    expect(text).toMatch(/quote/);
    expect(text).toMatch(/Dana/);
    expect(text).toMatch(/1 Main St/);
    expect(text).not.toMatch(/^Phone:/m);
  });
});
