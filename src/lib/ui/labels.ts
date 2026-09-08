import type { UiCopy } from "./types";

/** snake_case -> "Snake case", so an unmapped key never renders as a raw token. */
function humanizeKey(key: string): string {
  const spaced = key.replaceAll("_", " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function lookupLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? humanizeKey(key);
}

/**
 * Label for a lead schema field. Tenants can add their own keys, so this always
 * degrades to a readable string rather than leaking `visit_kind` into the UI.
 */
export function leadFieldLabel(ui: UiCopy, key: string): string {
  return lookupLabel(ui.leadFields, key);
}

export function stageLabel(ui: UiCopy, stageId: string): string {
  return lookupLabel(ui.stages, stageId);
}

export function intentLabel(ui: UiCopy, intent: string): string {
  return lookupLabel(ui.intents, intent);
}

export function stageTypeLabel(ui: UiCopy, type: string): string {
  return lookupLabel(ui.stageTypes, type);
}

export function convoStatusLabel(ui: UiCopy, status: string): string {
  return lookupLabel(ui.convoStatus, status);
}

export function restartPolicyLabel(ui: UiCopy, policy: string): string {
  return lookupLabel(ui.restartPolicy, policy);
}

export function actionLabel(ui: UiCopy, action: string): string {
  return lookupLabel(ui.actions, action);
}

export function meetingKindLabel(ui: UiCopy, kind: string): string {
  return lookupLabel(ui.meetingKinds, kind);
}

export function hitlReasonLabel(ui: UiCopy, reason: string): string {
  return ui.inbox.reasons[reason] ?? humanizeKey(reason);
}
