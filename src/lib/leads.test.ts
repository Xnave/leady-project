import { describe, expect, it } from "vitest";
import { channelLabel, displayNameFromLeadFields, isDemoLead, leadDisplayName } from "./leads";
import { normalizeLeadStatus } from "./ui";

describe("leads helpers", () => {
  it("treats demo- prefix as demo", () => {
    expect(isDemoLead("demo-abc")).toBe(true);
    expect(isDemoLead("+97250")).toBe(false);
  });

  it("extracts a usable display name from fields", () => {
    expect(displayNameFromLeadFields({ name: "Dana Levi" })).toBe("Dana Levi");
    expect(displayNameFromLeadFields({ name: "1634072858426706" })).toBeUndefined();
    expect(displayNameFromLeadFields({})).toBeUndefined();
  });

  it("prefers fields.name", () => {
    expect(
      leadDisplayName({
        displayName: "WA name",
        externalUserId: "u1",
        fields: { name: "Dana" },
      }),
    ).toBe("Dana");
  });

  it("does not show a numeric Instagram id as the name", () => {
    expect(
      leadDisplayName({
        displayName: "1634072858426706",
        externalUserId: "1634072858426706",
        fields: { instagramUsername: "jane_doe", name: "Jane" },
      }),
    ).toBe("Jane (@jane_doe)");
  });

  it("maps closed to lost", () => {
    expect(normalizeLeadStatus("closed")).toBe("lost");
    expect(normalizeLeadStatus("open")).toBe("open");
  });

  it("labels the channel", () => {
    expect(channelLabel("he", { provider: "whatsapp", providerAccountId: "+1" })).toContain(
      "וואטסאפ",
    );
  });
});
