import { describe, expect, it } from "vitest";
import type { TurnContext } from "@/lib/flow/types";
import { personaOf } from "./context";
import { DEFAULT_PERSONA } from "./presets";

describe("personaOf", () => {
  it("returns the agent's persona, or the default when absent", () => {
    const withPersona = { agent: { persona: { ...DEFAULT_PERSONA, agentName: "Noa" } } } as TurnContext;
    expect(personaOf(withPersona).agentName).toBe("Noa");
    expect(personaOf({ agent: {} } as TurnContext)).toEqual(DEFAULT_PERSONA);
  });
});
