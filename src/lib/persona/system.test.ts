import { afterEach, describe, expect, it } from "vitest";
import type { TurnContext } from "@/lib/flow/types";
import { DEFAULT_PERSONA } from "./presets";
import { faqSystemPrompt, voicePreamble } from "./system";

const ctx = {
  tenant: { name: "Acme", phone: "", intro: "", chatLanguage: "multi" },
  agent: { persona: { ...DEFAULT_PERSONA, agentName: "Dana", length: "short" } },
  channel: { provider: "whatsapp" },
} as unknown as TurnContext;

describe("voicePreamble", () => {
  afterEach(() => {
    delete process.env.PROMPT_PIPELINE;
  });

  it("includes identity, persona and craft", () => {
    const s = voicePreamble(ctx, "en");
    expect(s).toMatch(/You are Dana from Acme/);
    expect(s).toMatch(/1–2 short sentences/);
    expect(s).toMatch(/CONVERSATION CRAFT/);
  });

  it("empty in legacy pipeline", () => {
    process.env.PROMPT_PIPELINE = "legacy";
    expect(voicePreamble(ctx, "en")).toBe("");
  });
});

describe("faqSystemPrompt", () => {
  it("keeps the UNRESOLVED contract above the style guidance", () => {
    const s = faqSystemPrompt(ctx, "en", "Knowledge:\nWe sell widgets.\nIf the knowledge does not answer, reply with exactly UNRESOLVED.");
    expect(s).not.toMatch(/offer the concrete alternative/);
    expect(s).toMatch(/output exactly UNRESOLVED/);
    expect(s.indexOf("output exactly UNRESOLVED")).toBeGreaterThan(s.indexOf("PERSONA"));
  });
});
