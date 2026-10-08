import { DEFAULT_PERSONA, matchPreset } from "./presets";
import { PERSONA_ENUMS, PERSONA_LIMITS, type Persona } from "./types";

export type PersonaIssue = {
  field: "agentName" | "rules" | "knob";
  index?: number;
  code: "too_long" | "too_many" | "override" | "unknown_value";
};

export class PersonaConfigError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly issues: PersonaIssue[] = [],
  ) {
    super(errors.join("; "));
    this.name = "PersonaConfigError";
  }
}

// Owner text is style only; anything that reads like "drop your instructions" or carries a link is refused.
const OVERRIDE_RE =
  /(ignore|disregard|forget|override)\s+(?:(?:all|the|any|your|my|of|everything)\s+)*(previous|prior|above|instructions|rules|guidelines|everything)|system\s*prompt|https?:\/\/|www\./i;
const OVERRIDE_HE_RE = /(התעלמ|תתעלמ|התעלם|שכח|תשכח)[^\n]{0,30}(הוראות|הנחיות|כללים)/;

const isOverride = (s: string) => OVERRIDE_RE.test(s) || OVERRIDE_HE_RE.test(s);
/** One line per value: newlines would let a rule fake a prompt section header. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

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
    .map(oneLine)
    .filter(Boolean);
}

/** Lenient: never throws. Used at turn time on stored JSON. */
export function normalizePersona(raw: unknown): Persona {
  const d = DEFAULT_PERSONA;
  if (!isObj(raw)) return { ...d, rules: [] };
  const p: Persona = {
    presetId: d.presetId,
    agentName:
      typeof raw.agentName === "string" ? oneLine(raw.agentName).slice(0, PERSONA_LIMITS.nameChars) : "",
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
  const issues: PersonaIssue[] = [];
  const fail = (msg: string, issue: PersonaIssue) => {
    errors.push(msg);
    issues.push(issue);
  };
  for (const key of KNOBS) {
    if (raw[key] !== undefined && !inEnum(key, raw[key])) {
      fail(`${key}: unknown value "${String(raw[key])}"`, { field: "knob", code: "unknown_value" });
    }
  }
  const name = typeof raw.agentName === "string" ? oneLine(raw.agentName) : "";
  if (name.length > PERSONA_LIMITS.nameChars) {
    fail(`agentName: max ${PERSONA_LIMITS.nameChars} characters`, { field: "agentName", code: "too_long" });
  }
  if (isOverride(name)) {
    fail("agentName: can't contain instructions or links", { field: "agentName", code: "override" });
  }
  const rules = cleanRules(raw.rules);
  if (rules.length > PERSONA_LIMITS.rules) {
    fail(`rules: max ${PERSONA_LIMITS.rules} rules`, { field: "rules", code: "too_many" });
  }
  rules.forEach((r, i) => {
    if (r.length > PERSONA_LIMITS.ruleChars) {
      fail(`rules[${i}]: max ${PERSONA_LIMITS.ruleChars} characters`, { field: "rules", index: i, code: "too_long" });
    }
    if (isOverride(r)) {
      fail(`rules[${i}]: rules can't change the agent's system instructions or include links`, {
        field: "rules",
        index: i,
        code: "override",
      });
    }
  });
  if (errors.length) throw new PersonaConfigError(errors, issues);
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
