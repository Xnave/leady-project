import { applyPreset, matchPreset, type BuiltinPresetId } from "@/lib/persona/presets";
import { PERSONA_LIMITS, type Persona, type StyleKnobs } from "@/lib/persona/types";

export type DraftAction =
  | { type: "preset"; id: BuiltinPresetId }
  | { type: "set"; key: keyof StyleKnobs | "gender"; value: string }
  | { type: "name"; value: string }
  | { type: "addRule" }
  | { type: "editRule"; index: number; value: string }
  | { type: "removeRule"; index: number }
  | { type: "reset"; persona: Persona };

export function draftReducer(s: Persona, a: DraftAction): Persona {
  switch (a.type) {
    case "preset":
      return applyPreset(a.id, { agentName: s.agentName, gender: s.gender, rules: s.rules });
    case "set": {
      const next = { ...s, [a.key]: a.value } as Persona;
      return { ...next, presetId: matchPreset(next) };
    }
    case "name":
      return { ...s, agentName: a.value.slice(0, PERSONA_LIMITS.nameChars) };
    case "addRule":
      return s.rules.length >= PERSONA_LIMITS.rules ? s : { ...s, rules: [...s.rules, ""] };
    case "editRule":
      return {
        ...s,
        rules: s.rules.map((r, i) => (i === a.index ? a.value.slice(0, PERSONA_LIMITS.ruleChars) : r)),
      };
    case "removeRule":
      return { ...s, rules: s.rules.filter((_, i) => i !== a.index) };
    case "reset":
      return a.persona;
  }
}

/** What the server would store: trimmed name, no blank rules. */
export function cleanDraft(p: Persona): Persona {
  return { ...p, agentName: p.agentName.trim(), rules: p.rules.map((r) => r.trim()).filter(Boolean) };
}

export const isDirty = (saved: Persona, draft: Persona) =>
  JSON.stringify(cleanDraft(saved)) !== JSON.stringify(cleanDraft(draft));

/** Server allows one preview per tenant every 4s; wait out the rest (+ margin) instead of hitting 429. */
const PREVIEW_GAP_MS = 4200;
export function previewWait(lastStart: number | undefined, now: number): number {
  if (lastStart === undefined) return 0;
  return Math.max(0, PREVIEW_GAP_MS - (now - lastStart));
}
