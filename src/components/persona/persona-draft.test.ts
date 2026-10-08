import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA } from "@/lib/persona/presets";
import type { Persona } from "@/lib/persona/types";
import { draftReducer, isDirty, previewWait } from "./persona-draft";

describe("persona draft", () => {
  it("picking a preset keeps name, gender, rules", () => {
    const s = draftReducer(
      { ...DEFAULT_PERSONA, agentName: "Noa", gender: "female", rules: ["x"] },
      { type: "preset", id: "precise_short" },
    );
    expect(s).toMatchObject({
      presetId: "precise_short",
      length: "short",
      agentName: "Noa",
      gender: "female",
      rules: ["x"],
    });
  });

  it("changing a knob recomputes presetId", () => {
    const s = draftReducer(DEFAULT_PERSONA, { type: "set", key: "tone", value: "direct" });
    expect(s.presetId).toBe("custom");
    const back = draftReducer(s, { type: "set", key: "tone", value: "friendly" });
    expect(back.presetId).toBe("warm_concierge");
  });

  it("gender change keeps the preset", () => {
    const s = draftReducer(DEFAULT_PERSONA, { type: "set", key: "gender", value: "female" });
    expect(s.presetId).toBe("warm_concierge");
  });

  it("rule add/edit/remove, max 5", () => {
    let s: Persona = DEFAULT_PERSONA;
    for (let i = 0; i < 7; i++) s = draftReducer(s, { type: "addRule" });
    expect(s.rules).toHaveLength(5);
    s = draftReducer(s, { type: "editRule", index: 0, value: "Always smile" });
    s = draftReducer(s, { type: "removeRule", index: 1 });
    expect(s.rules[0]).toBe("Always smile");
    expect(s.rules).toHaveLength(4);
  });

  it("isDirty ignores trailing empty rules and whitespace", () => {
    expect(isDirty(DEFAULT_PERSONA, { ...DEFAULT_PERSONA, rules: [""] })).toBe(false);
    expect(isDirty(DEFAULT_PERSONA, { ...DEFAULT_PERSONA, agentName: " " })).toBe(false);
    expect(isDirty(DEFAULT_PERSONA, { ...DEFAULT_PERSONA, tone: "direct", presetId: "custom" })).toBe(true);
  });
});

describe("previewWait", () => {
  it("waits out the rest of the server's 4s window, never negative", () => {
    expect(previewWait(undefined, 10_000)).toBe(0);
    expect(previewWait(10_000, 11_500)).toBe(2_700);
    expect(previewWait(10_000, 20_000)).toBe(0);
  });
});
