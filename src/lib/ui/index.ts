import { en } from "./en";
import { he } from "./he";
import type { UiCopy, UiLang, UiTheme } from "./types";

export type { UiCopy, UiLang, UiTheme, LeadStatusId, CatalogUiId } from "./types";
export { LEAD_STATUSES, normalizeLeadStatus } from "./status";

export function isUiLang(value: string | undefined | null): value is UiLang {
  return value === "he" || value === "en";
}

export function isUiTheme(value: string | undefined | null): value is UiTheme {
  return value === "system" || value === "light" || value === "dark";
}

export function uiCopy(lang: UiLang): UiCopy {
  return lang === "en" ? en : he;
}

export function fillUi(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function stepLabel(ui: UiCopy, current: number, total: number): string {
  return fillUi(ui.common.stepOf, { current, total });
}

export function actingAsLabel(ui: UiCopy, name: string): string {
  return fillUi(ui.actingAs, { name });
}

export {
  stageLabel,
  intentLabel,
  stageTypeLabel,
  convoStatusLabel,
  restartPolicyLabel,
  actionLabel,
  hitlReasonLabel,
  leadFieldLabel,
  requestKindLabel,
} from "./labels";

export function roleLabel(ui: UiCopy, role: string): string {
  if (role === "lead" || role === "agent" || role === "human") {
    return ui.roles[role];
  }
  return role;
}
