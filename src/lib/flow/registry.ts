import type { ActionStage, TalkStage, TurnContext } from "./types";

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
  /** Extra system-prompt lines for this capability. */
  promptSection: (opts: {
    ctx: TurnContext;
    stage: TalkStage;
    fields: import("./types").LeadFields;
  }) => string[];
  /** Build LLM tools when this capability is active (and no higher-priority mode). */
  tools?: CapabilityToolFactory;
};

const actions = new Map<string, ActionHandler>();
const capabilities = new Map<string, CapabilityDefinition>();

export function registerAction(id: string, handler: ActionHandler): void {
  actions.set(id, handler);
}

export function getAction(id: string): ActionHandler | undefined {
  return actions.get(id);
}

export function listActions(): string[] {
  return [...actions.keys()];
}

export function registerCapability(def: CapabilityDefinition): void {
  capabilities.set(def.id, def);
}

export function getCapability(id: string): CapabilityDefinition | undefined {
  return capabilities.get(id);
}

export function resolveTalkCapabilities(stage: TalkStage): string[] {
  if (stage.capabilities?.length) return stage.capabilities;
  if (stage.allowBook === false) return [];
  return ["booking"];
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
