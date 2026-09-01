import { describe, expect, it } from "vitest";
import { applyOnboardExtract, normalizeOnboardExtract } from "./onboard-extract";

describe("onboard extract", () => {
  it("drops blank extracted fields", () => {
    expect(
      normalizeOnboardExtract({
        name: "  Gold Co  ",
        phone: " ",
        intro: "",
        chatLanguage: "he",
      }),
    ).toEqual({
      name: "Gold Co",
      phone: undefined,
      intro: undefined,
      venueAddress: undefined,
      venueHours: undefined,
      chatLanguage: "he",
    });
  });

  it("fills only fields the model found", () => {
    const next = applyOnboardExtract(
      { name: "Old", phone: "", intro: "Keep me", venueHours: "" },
      { name: "New Co", venueHours: "09:00–18:00", phone: "  " },
    );
    expect(next.name).toBe("New Co");
    expect(next.intro).toBe("Keep me");
    expect(next.venueHours).toBe("09:00–18:00");
    expect(next.phone).toBe("");
  });
});
