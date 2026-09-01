import { en } from "./en";
import { he } from "./he";
import type { UiCopy, UiLang } from "./types";

export type { UiCopy, UiLang, LeadStatusId } from "./types";
export { LEAD_STATUSES, normalizeLeadStatus } from "./status";

export function isUiLang(value: string | undefined | null): value is UiLang {
  return value === "he" || value === "en";
}

export function uiCopy(lang: UiLang): UiCopy {
  return lang === "en" ? en : he;
}
