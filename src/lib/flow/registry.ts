import type { ActionStage, TalkEffect, TalkStage, TurnContext } from "./types";

export type ActionHandler = (
  ctx: TurnContext,
  stage: ActionStage,
) => Promise<{ ok: boolean; reply: string }>;

export type CapabilityToolFactory = (opts: {
  ctx: TurnContext;
  stage: TalkStage;
  collected: import("./types").TalkOutcome & {
    askFieldUsed?: boolean;
    replyLocked?: boolean;
  };
}) => Record<string, unknown>;

export type CapabilityDefinition = {
  id: string;
  /** Session/CRM field keys owned by this capability (merged into talk allowlist). */
  sessionFieldKeys?: readonly string[];
  /** Extra system-prompt lines for this capability. */
  promptSection: (opts: {
    ctx: TurnContext;
    stage: TalkStage;
    fields: import("./types").LeadFields;
  }) => string[];
  /** Closing rules that apply only when this capability is active. */
  closingLines?: () => string[];
  /** Build LLM tools when this capability is active. */
  tools?: CapabilityToolFactory;
};

/** Minimal ports needed by talk-effect handlers (avoids circular import with interpreter). */
export type TalkEffectPorts = {
  bookMeeting: (ctx: TurnContext) => Promise<{ ok: boolean; reply: string }>;
  persistStage: (ctx: TurnContext, stageId: string) => Promise<void>;
  sendAndSave: (ctx: TurnContext, text: string) => Promise<void>;
};

/** Result of handling one talk effect. */
export type TalkEffectHandleResult = {
  reply?: string;
  escalateReason?: string;
  bookedOk?: boolean;
  /** Stop the turn and return this result from the interpreter. */
  halt?: {
    stage: string;
    action?: string;
    ok?: boolean;
    effects?: string[];
    reply?: string;
  };
};

export type TalkEffectHandler = (opts: {
  ctx: TurnContext;
  stage: TalkStage;
  effect: TalkEffect;
  ports: TalkEffectPorts;
  reply: string;
}) => Promise<TalkEffectHandleResult>;

const actions = new Map<string, ActionHandler>();
const capabilities = new Map<string, CapabilityDefinition>();
const talkEffects = new Map<string, TalkEffectHandler>();
const sessionKeyOwners = new Map<string, string>();

export function registerAction(id: string, handler: ActionHandler): void {
  actions.set(id, handler);
}

export function getAction(id: string): ActionHandler | undefined {
  return actions.get(id);
}

export function listActions(): string[] {
  return [...actions.keys()];
}

export function registerTalkEffect(type: string, handler: TalkEffectHandler): void {
  talkEffects.set(type, handler);
}

export function getTalkEffect(type: string): TalkEffectHandler | undefined {
  return talkEffects.get(type);
}

export function registerCapability(def: CapabilityDefinition): void {
  capabilities.set(def.id, def);
  for (const key of def.sessionFieldKeys ?? []) {
    sessionKeyOwners.set(key, def.id);
  }
}

export function getCapability(id: string): CapabilityDefinition | undefined {
  return capabilities.get(id);
}

/**
 * Explicit capabilities only. Legacy: allowBook false → []; allowBook true with
 * unset capabilities → ["booking"] for old flows that never set the array.
 * New flows always set capabilities explicitly via flow builders.
 */
export function resolveTalkCapabilities(stage: TalkStage): string[] {
  if (stage.capabilities) return stage.capabilities;
  if (stage.allowBook === false) return [];
  if (stage.allowBook === true) return ["booking"];
  return [];
}

export function capabilityPromptSections(opts: {
  ctx: TurnContext;
  stage: TalkStage;
  fields: import("./types").LeadFields;
}): string[] {
  const lines: string[] = [];
  for (const id of resolveTalkCapabilities(opts.stage)) {
    const cap = capabilities.get(id);
    if (cap) lines.push(...cap.promptSection(opts));
  }
  return lines;
}

export function capabilityClosingLines(stage: TalkStage): string[] {
  const lines: string[] = [];
  for (const id of resolveTalkCapabilities(stage)) {
    const cap = capabilities.get(id);
    if (cap?.closingLines) lines.push(...cap.closingLines());
  }
  return lines;
}

/** Session field keys for active capabilities on a talk stage. */
export function sessionFieldKeysForStage(stage: TalkStage): string[] {
  const keys = new Set<string>();
  for (const id of resolveTalkCapabilities(stage)) {
    const cap = capabilities.get(id);
    for (const k of cap?.sessionFieldKeys ?? []) keys.add(k);
  }
  return [...keys];
}

/** All session keys registered by any capability (for CRM/session split). */
export function allCapabilitySessionFieldKeys(): string[] {
  return [...sessionKeyOwners.keys()];
}

export function isCapabilitySessionKey(key: string): boolean {
  return sessionKeyOwners.has(key);
}
