import { DEFAULT_PERSONA, matchPreset } from "./presets";
import { PERSONA_ENUMS, PERSONA_LIMITS, type Persona } from "./types";

export class PersonaConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join("; "));
    this.name = "PersonaConfigError";
  }
}

const OVERRIDE_RE =
  /(ignore|disregard|forget)\s+(all\s+|the\s+|any\s+)?(previous|prior|above)|system\s*prompt|https?:\/\/|www\./i;

const KNOBS = ["gender", "tone", "length", "formality", "emoji", "questionStyle"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function inEnum<K extends keyof typeof PERSONA_ENUMS>(key: K, v: unknown): v is (typeof PERSONA_ENUMS)[K][number] {
  return (PERSONA_ENUMS[key] as readonly unknown[]).includes(v);
}

function cleanRules(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.trim())
    .filter(Boolean);
}

/** Lenient: never throws. Used at turn time on stored JSON. */
export function normalizePersona(raw: unknown): Persona {
  const d = DEFAULT_PERSONA;
  if (!isObj(raw)) return { ...d, rules: [] };
  const p: Persona = {
    presetId: d.presetId,
    agentName:
      typeof raw.agentName === "string" ? raw.agentName.trim().slice(0, PERSONA_LIMITS.nameChars) : "",
    gender: inEnum("gender", raw.gender) ? raw.gender : d.gender,
    tone: inEnum("tone", raw.tone) ? raw.tone : d.tone,
    length: inEnum("length", raw.length) ? raw.length : d.length,
    formality: inEnum("formality", raw.formality) ? raw.formality : d.formality,
    emoji: inEnum("emoji", raw.emoji) ? raw.emoji : d.emoji,
    questionStyle: inEnum("questionStyle", raw.questionStyle) ? raw.questionStyle : d.questionStyle,
    rules: cleanRules(raw.rules)
      .slice(0, PERSONA_LIMITS.rules)
      .map((r) => r.slice(0, PERSONA_LIMITS.ruleChars)),
  };
  return { ...p, presetId: matchPreset(p) };
}

/** Strict: used on write. Throws PersonaConfigError listing every problem. */
export function validatePersona(raw: unknown): Persona {
  if (!isObj(raw)) throw new PersonaConfigError(["persona must be an object"]);
  const errors: string[] = [];
  for (const key of KNOBS) {
    if (raw[key] !== undefined && !inEnum(key, raw[key])) {
      errors.push(`${key}: unknown value "${String(raw[key])}"`);
    }
  }
  const name = typeof raw.agentName === "string" ? raw.agentName.trim() : "";
  if (name.length > PERSONA_LIMITS.nameChars) {
    errors.push(`agentName: max ${PERSONA_LIMITS.nameChars} characters`);
  }
  const rules = cleanRules(raw.rules);
  if (rules.length > PERSONA_LIMITS.rules) errors.push(`rules: max ${PERSONA_LIMITS.rules} rules`);
  rules.forEach((r, i) => {
    if (r.length > PERSONA_LIMITS.ruleChars) {
      errors.push(`rules[${i}]: max ${PERSONA_LIMITS.ruleChars} characters`);
    }
    if (OVERRIDE_RE.test(r)) {
      errors.push(`rules[${i}]: rules can't change the agent's system instructions or include links`);
    }
  });
  if (errors.length) throw new PersonaConfigError(errors);
  return normalizePersona(raw);
}

/** For optional persona payloads (onboarding): valid → persona, anything else → undefined (keep stored). */
export function tryValidatePersona(raw: unknown): Persona | undefined {
  if (raw === undefined || raw === null) return undefined;
  try {
    return validatePersona(raw);
  } catch {
    return undefined;
  }
}
