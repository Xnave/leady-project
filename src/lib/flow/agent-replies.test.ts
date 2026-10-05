import { describe, expect, it } from "vitest";
import { agentRepliesAllowed } from "./agent-replies";

describe("agentRepliesAllowed", () => {
  it("allows replies when flags are missing or true", () => {
    expect(agentRepliesAllowed({})).toBe(true);
    expect(
      agentRepliesAllowed({
        tenant: {
          name: "T",
          phone: "",
          intro: "",
          chatLanguage: "en",
          agentRepliesEnabled: true,
        },
        channel: { provider: "whatsapp", agentRepliesEnabled: true },
      }),
    ).toBe(true);
  });

  it("blocks when tenant is muted", () => {
    expect(
      agentRepliesAllowed({
        tenant: {
          name: "T",
          phone: "",
          intro: "",
          chatLanguage: "en",
          agentRepliesEnabled: false,
        },
        channel: { provider: "whatsapp", agentRepliesEnabled: true },
      }),
    ).toBe(false);
  });

  it("blocks when channel is muted", () => {
    expect(
      agentRepliesAllowed({
        tenant: {
          name: "T",
          phone: "",
          intro: "",
          chatLanguage: "en",
          agentRepliesEnabled: true,
        },
        channel: { provider: "whatsapp", agentRepliesEnabled: false },
      }),
    ).toBe(false);
  });
});
