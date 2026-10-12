import type { Persona, PresetId, StyleKnobs } from "./types";

export type BuiltinPresetId = Exclude<PresetId, "custom">;
export type PresetDef = { id: BuiltinPresetId; persona: StyleKnobs };

export const PRESETS: Record<BuiltinPresetId, PresetDef> = {
  warm_concierge: {
    id: "warm_concierge",
    persona: { tone: "friendly", length: "auto", formality: "casual", emoji: "light" },
  },
  precise_short: {
    id: "precise_short",
    persona: { tone: "direct", length: "short", formality: "casual", emoji: "none" },
  },
  premium_formal: {
    id: "premium_formal",
    persona: { tone: "professional", length: "medium", formality: "formal", emoji: "none" },
  },
  upbeat_sales: {
    id: "upbeat_sales",
    persona: { tone: "cheerful", length: "medium", formality: "casual", emoji: "light" },
  },
};

export function applyPreset(
  id: BuiltinPresetId,
  keep: Pick<Persona, "agentName" | "gender" | "rules">,
): Persona {
  return { presetId: id, ...PRESETS[id].persona, ...keep };
}

export const DEFAULT_PERSONA: Persona = applyPreset("warm_concierge", {
  agentName: "",
  gender: "female",
  rules: [],
});

/** Which preset (if any) exactly matches the style knobs. */
export function matchPreset(p: StyleKnobs): PresetId {
  for (const def of Object.values(PRESETS)) {
    const k = def.persona;
    if (
      k.tone === p.tone &&
      k.length === p.length &&
      k.formality === p.formality &&
      k.emoji === p.emoji
    ) {
      return def.id;
    }
  }
  return "custom";
}
