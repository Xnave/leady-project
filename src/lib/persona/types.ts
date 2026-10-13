export const PERSONA_ENUMS = {
  presetId: ["warm_concierge", "precise_short", "premium_formal", "upbeat_sales", "custom"],
  gender: ["female", "male"],
  tone: ["friendly", "professional", "cheerful", "direct"],
  /** auto = no length rule; the model fits each reply. */
  length: ["short", "medium", "auto"],
  formality: ["casual", "formal"],
  emoji: ["none", "light"],
} as const;

type E<K extends keyof typeof PERSONA_ENUMS> = (typeof PERSONA_ENUMS)[K][number];

export type PresetId = E<"presetId">;
export type PersonaGender = E<"gender">;

/** How the agent sounds. Style only — never changes what the agent is allowed to do. */
export type Persona = {
  presetId: PresetId;
  /** "" = no name; the agent introduces itself as the business's digital assistant. */
  agentName: string;
  gender: PersonaGender;
  tone: E<"tone">;
  length: E<"length">;
  formality: E<"formality">;
  emoji: E<"emoji">;
  rules: string[];
};

export type StyleKnobs = Pick<Persona, "tone" | "length" | "formality" | "emoji">;

export const PERSONA_LIMITS = { rules: 5, ruleChars: 160, nameChars: 40 } as const;
