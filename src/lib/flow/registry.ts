import type { ActionStage, TalkEffect, TalkStage, TurnContext } from "./types";

export type ActionHandler = (
  ctx: TurnContext,
  stage?: ActionStage,
) => Promise<{ ok: boolean; reply: string }>;

export type CapabilityToolFactory = (opts: {
  ctx: TurnContext;
  stage: TalkStage;
  collected: import("./types").TalkOutcome & {
    askFieldUsed?: boolean;
    replyLocked?: boolean;
    timeRejected?: boolean;
  };
}) => Record<string, unknown>;

/**
 * Loads whatever durable state this capability needs on the turn context
 * (e.g. the lead's still-relevant open request). Runs during `loadTurnContext`,
 * which stays generic: it iterates registered capabilities instead of naming them.
 */
export type CapabilityStateLoader = (args: {
  tenantId: string;
  leadId: string;
  conversationId: string;
}) => Promise<unknown>;

/**
 * One approval decision on a request, in the vocabulary of the shared time spine:
 * a point-in-time request reads `alternativeStart` only, a span reads both ends.
 */
export type RequestDecisionInput = {
  tenantId: string;
  requestId: string;
  actorUserId: string;
  decision: "approve" | "decline" | "reschedule";
  note?: string;
  customReply?: string;
  alternativeStart?: string;
  alternativeEnd?: string;
  /** The customer accepted a staff-offered alternative rather than an operator deciding. */
  customerConfirmed?: boolean;
};

export type RequestDecisionOutcome = {
  conversationId: string;
  leadId: string;
  /** Message to send the customer. */
  text: string;
  closeAsDone: boolean;
  reopenTalk: boolean;
};

export type RequestDecisionHandler = (
  input: RequestDecisionInput,
) => Promise<RequestDecisionOutcome>;

export type CapabilityDefinition = {
  id: string;
  /** Static session/CRM field keys owned by this capability. */
  sessionFieldKeys?: readonly string[];
  /** Session keys that depend on tenant config; merged with the static list. */
  dynamicSessionKeys?: (ctx: TurnContext) => string[];
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
  /**
   * Enforce invariants the model may have skipped, after the talk turn and before
   * effects run. Keeps domain guardrails out of the interpreter.
   */
  reconcile?: (opts: {
    ctx: TurnContext;
    stage: TalkStage;
    outcome: import("./types").TalkOutcome;
  }) => import("./types").TalkOutcome;
  /** Durable state to hang on `TurnContext.capabilityState[id]`. */
  loadState?: CapabilityStateLoader;
  /**
   * Apply an operator's approve / decline / reschedule to one of this
   * capability's requests and word the customer's message. Registered here so
   * the decide route and the HITL completion route stay vertical-agnostic.
   */
  decide?: RequestDecisionHandler;
};

/** Ports available to talk-effect handlers. Generic: never grows per capability. */
export type TalkEffectPorts = {
  /** Invoke a registered action/effect by id (books a visit, holds a stay, …). */
  runEffect: (
    ctx: TurnContext,
    effectId: string,
  ) => Promise<{ ok: boolean; reply: string }>;
  persistStage: (ctx: TurnContext, stageId: string) => Promise<void>;
  sendAndSave: (ctx: TurnContext, text: string) => Promise<void>;
};

/** Result of handling one talk effect. */
export type TalkEffectHandleResult = {
  reply?: string;
  escalateReason?: string;
  /** A durable effect failed: send `reply` and end the turn with this action. */
  failedAction?: string;
  /** Advance to `stage.on_complete` after the effect loop, logged as this action. */
  completeAction?: string;
  /** Stop the turn immediately and return this result from the interpreter. */
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

/**
 * Legacy `TalkOutcome` boolean flags (`book`, `acceptOfferedSlot`) mapped to effects.
 * Declared by the owning capability so the interpreter's normalization step does not
 * name any domain.
 */
export type OutcomeFlagMapping = {
  /** Boolean field on `TalkOutcome`. */
  flag: string;
  /** Effect pushed when the flag is set. */
  effectId: string;
  /** Also advance to the talk stage's `on_complete`. */
  completesStage?: boolean;
};

const actions = new Map<string, ActionHandler>();
const capabilities = new Map<string, CapabilityDefinition>();
const talkEffects = new Map<string, TalkEffectHandler>();
const sessionKeyOwners = new Map<string, string>();
const outcomeFlags = new Map<string, OutcomeFlagMapping>();

export function registerOutcomeFlag(mapping: OutcomeFlagMapping): void {
  outcomeFlags.set(mapping.flag, mapping);
}

export function outcomeFlagMappings(): OutcomeFlagMapping[] {
  return [...outcomeFlags.values()];
}

export function registerAction(id: string, handler: ActionHandler): void {
  actions.set(id, handler);
}

export function getAction(id: string): ActionHandler | undefined {
  return actions.get(id);
}

export function listActions(): string[] {
  return [...actions.keys()];
}

/**
 * Invoke a registered action/effect. This is the single generic seam for every
 * durable capability side effect — the interpreter has no per-domain ports.
 */
export async function runCapabilityEffect(
  ctx: TurnContext,
  effectId: string,
  stage?: ActionStage,
): Promise<{ ok: boolean; reply: string }> {
  const handler = actions.get(effectId);
  if (!handler) return { ok: false, reply: `Unknown action: ${effectId}` };
  return handler(ctx, stage);
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

export function listCapabilities(): CapabilityDefinition[] {
  return [...capabilities.values()];
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

function activeCapabilities(stage: TalkStage): CapabilityDefinition[] {
  const out: CapabilityDefinition[] = [];
  for (const id of resolveTalkCapabilities(stage)) {
    const cap = capabilities.get(id);
    if (cap) out.push(cap);
  }
  return out;
}

export function capabilityPromptSections(opts: {
  ctx: TurnContext;
  stage: TalkStage;
  fields: import("./types").LeadFields;
}): string[] {
  const lines: string[] = [];
  for (const cap of activeCapabilities(opts.stage)) {
    lines.push(...cap.promptSection(opts));
  }
  return lines;
}

export function capabilityClosingLines(stage: TalkStage): string[] {
  const lines: string[] = [];
  for (const cap of activeCapabilities(stage)) {
    if (cap.closingLines) lines.push(...cap.closingLines());
  }
  return lines;
}

/**
 * Run every active capability's `reconcile` hook over the talk outcome.
 * Replaces the booking-specific enforcement that used to live in the interpreter.
 */
export function reconcileTalkOutcome(opts: {
  ctx: TurnContext;
  stage: TalkStage;
  outcome: import("./types").TalkOutcome;
}): import("./types").TalkOutcome {
  let outcome = opts.outcome;
  for (const cap of activeCapabilities(opts.stage)) {
    if (cap.reconcile) {
      outcome = cap.reconcile({ ctx: opts.ctx, stage: opts.stage, outcome });
    }
  }
  return outcome;
}

/** Session field keys for active capabilities on a talk stage, including dynamic ones. */
export function sessionFieldKeysForStage(
  stage: TalkStage,
  ctx?: TurnContext,
): string[] {
  const keys = new Set<string>();
  for (const cap of activeCapabilities(stage)) {
    for (const k of cap.sessionFieldKeys ?? []) keys.add(k);
    if (ctx && cap.dynamicSessionKeys) {
      for (const k of cap.dynamicSessionKeys(ctx)) keys.add(k);
    }
  }
  return [...keys];
}

/**
 * Session keys for every registered capability, for the CRM/session split at
 * persist time (where the active stage is not necessarily known).
 */
export function allCapabilitySessionFieldKeys(ctx?: TurnContext): string[] {
  const keys = new Set<string>(sessionKeyOwners.keys());
  if (ctx) {
    for (const cap of capabilities.values()) {
      if (!cap.dynamicSessionKeys) continue;
      for (const k of cap.dynamicSessionKeys(ctx)) keys.add(k);
    }
  }
  return [...keys];
}

export function isCapabilitySessionKey(key: string): boolean {
  return sessionKeyOwners.has(key);
}

/** Capabilities that want durable state loaded onto the turn context. */
export function capabilityStateLoaders(): { id: string; load: CapabilityStateLoader }[] {
  const out: { id: string; load: CapabilityStateLoader }[] = [];
  for (const cap of capabilities.values()) {
    if (cap.loadState) out.push({ id: cap.id, load: cap.loadState });
  }
  return out;
}

/**
 * Route a decision to the capability that owns the request. Callers never learn
 * which vertical a request belongs to.
 */
export async function decideRegisteredRequest(
  capabilityId: string,
  input: RequestDecisionInput,
): Promise<RequestDecisionOutcome> {
  const decide = capabilities.get(capabilityId)?.decide;
  if (!decide) throw new Error(`capability_cannot_decide: ${capabilityId}`);
  return decide(input);
}

/** Typed read of state a capability stashed via `loadState`. */
export function capabilityState<T>(
  ctx: TurnContext,
  capabilityId: string,
): T | undefined {
  return ctx.capabilityState?.[capabilityId] as T | undefined;
}
