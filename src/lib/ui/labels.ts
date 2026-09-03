import type { UiCopy } from "./types";

export function lookupLabel(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replaceAll("_", " ");
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

export function hitlReasonLabel(ui: UiCopy, reason: string): string {
  return ui.inbox.reasons[reason] ?? reason;
}
