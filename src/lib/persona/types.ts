export const PERSONA_ENUMS = {
  presetId: ["warm_concierge", "precise_short", "premium_formal", "upbeat_sales", "custom"],
  gender: ["female", "male", "neutral"],
  tone: ["friendly", "professional", "cheerful", "direct"],
  length: ["short", "medium", "detailed"],
  formality: ["casual", "formal"],
  emoji: ["none", "light"],
  questionStyle: ["one_at_a_time", "bundled"],
} as const;

type E<K extends keyof typeof PERSONA_ENUMS> = (typeof PERSONA_ENUMS)[K][number];

export type PresetId = E<"presetId">;
export type PersonaGender = E<"gender">;

/** How the agent sounds. Style only — never changes what the agent is allowed to do. */
export type Persona = {
  presetId: PresetId;
  /** "" = speak as the business ("we"). */
  agentName: string;
  gender: PersonaGender;
  tone: E<"tone">;
  length: E<"length">;
  formality: E<"formality">;
  emoji: E<"emoji">;
  questionStyle: E<"questionStyle">;
  rules: string[];
};

export type StyleKnobs = Pick<Persona, "tone" | "length" | "formality" | "emoji" | "questionStyle">;

export const PERSONA_LIMITS = { rules: 5, ruleChars: 160, nameChars: 40 } as const;
