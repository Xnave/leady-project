import { describe, expect, it } from "vitest";
import { channelLabel, isDemoLead, leadDisplayName } from "./leads";
import { normalizeLeadStatus } from "./ui";

describe("leads helpers", () => {
  it("treats demo- prefix as demo", () => {
    expect(isDemoLead("demo-abc")).toBe(true);
    expect(isDemoLead("+97250")).toBe(false);
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
