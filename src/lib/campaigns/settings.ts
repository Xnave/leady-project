/**
 * Client campaigns add-on settings. Platform admins enable the add-on per tenant
 * and own the legal fields; the tenant only records terms acceptance.
 */

import { MAX_SENDS_PER_RUN, SEND_GAP_MS } from "./rules";

/** Bump when the campaign terms text changes; owners accept again. */
export const CAMPAIGN_TERMS_VERSION = "2026-11-03";

export const DEFAULT_DAILY_CEILING = 200;
export const MAX_DAILY_CEILING = 100_000;
export const MAX_SENDS_PER_RUN_CAP = 1000;
export const MAX_SEND_GAP_MS = 5000;
/** A legal note must say something: who approved and why. */
export const AD_PREFIX_NOTE_MIN = 10;

export type CampaignSettings = {
  enabled: boolean;
  adPrefixEnabled: boolean;
  adPrefixOffNote: string;
  adPrefixOffBy: string;
  adPrefixOffAt: string | null;
  dailySendCeiling: number;
  maxSendsPerRun: number;
  sendGapMs: number;
  termsVersion: string;
  termsAcceptedAt: string | null;
  termsAcceptedBy: string;
};

export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  enabled: false,
  adPrefixEnabled: true,
  adPrefixOffNote: "",
  adPrefixOffBy: "",
  adPrefixOffAt: null,
  dailySendCeiling: DEFAULT_DAILY_CEILING,
  maxSendsPerRun: MAX_SENDS_PER_RUN,
  sendGapMs: SEND_GAP_MS,
  termsVersion: "",
  termsAcceptedAt: null,
  termsAcceptedBy: "",
};

export type AdminSettingsInput = {
  enabled?: unknown;
  adPrefixEnabled?: unknown;
  adPrefixOffNote?: unknown;
  dailySendCeiling?: unknown;
  maxSendsPerRun?: unknown;
  sendGapMs?: unknown;
};

export type AdminSettingsPatch = {
  enabled: boolean;
  adPrefixEnabled: boolean;
  adPrefixOffNote: string;
  adPrefixOffBy: string;
  adPrefixOffAt: Date | null;
  dailySendCeiling: number;
  maxSendsPerRun: number;
  sendGapMs: number;
};

export type AdminSettingsError = "prefix_note_required" | "ceiling_invalid" | "pace_invalid";

/**
 * Turning the "פרסומת" prefix off needs a legal note. The note, the admin and
 * the time are kept while it stays off and cleared when it is turned back on.
 */
export function parseAdminSettings(
  input: AdminSettingsInput,
  current: CampaignSettings,
  actor: string,
  now: Date = new Date(),
): AdminSettingsPatch | { error: AdminSettingsError } {
  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const adPrefixEnabled = typeof input.adPrefixEnabled === "boolean" ? input.adPrefixEnabled : current.adPrefixEnabled;
  const ceilingRaw = input.dailySendCeiling ?? current.dailySendCeiling;
  const dailySendCeiling = Number(ceilingRaw);
  if (!Number.isInteger(dailySendCeiling) || dailySendCeiling < 1 || dailySendCeiling > MAX_DAILY_CEILING) {
    return { error: "ceiling_invalid" };
  }
  const maxSendsPerRun = Number(input.maxSendsPerRun ?? current.maxSendsPerRun);
  const sendGapMs = Number(input.sendGapMs ?? current.sendGapMs);
  if (!Number.isInteger(maxSendsPerRun) || maxSendsPerRun < 1 || maxSendsPerRun > MAX_SENDS_PER_RUN_CAP) return { error: "pace_invalid" };
  if (!Number.isInteger(sendGapMs) || sendGapMs < 0 || sendGapMs > MAX_SEND_GAP_MS) return { error: "pace_invalid" };
  const pace = { maxSendsPerRun, sendGapMs };

  if (adPrefixEnabled) {
    return { enabled, adPrefixEnabled, adPrefixOffNote: "", adPrefixOffBy: "", adPrefixOffAt: null, dailySendCeiling, ...pace };
  }
  const note = typeof input.adPrefixOffNote === "string" ? input.adPrefixOffNote.trim() : "";
  // Already off: keep the original approval unless a new note replaces it.
  if (!current.adPrefixEnabled && (!note || note === current.adPrefixOffNote)) {
    return {
      enabled,
      adPrefixEnabled,
      adPrefixOffNote: current.adPrefixOffNote,
      adPrefixOffBy: current.adPrefixOffBy,
      adPrefixOffAt: current.adPrefixOffAt ? new Date(current.adPrefixOffAt) : now,
      dailySendCeiling,
      ...pace,
    };
  }
  if (note.length < AD_PREFIX_NOTE_MIN) return { error: "prefix_note_required" };
  return { enabled, adPrefixEnabled, adPrefixOffNote: note, adPrefixOffBy: actor, adPrefixOffAt: now, dailySendCeiling, ...pace };
}

export function termsAccepted(s: Pick<CampaignSettings, "termsVersion" | "termsAcceptedAt">): boolean {
  return Boolean(s.termsAcceptedAt) && s.termsVersion === CAMPAIGN_TERMS_VERSION;
}

type Row = {
  enabled: boolean;
  adPrefixEnabled: boolean;
  adPrefixOffNote: string;
  adPrefixOffBy: string;
  adPrefixOffAt: Date | null;
  dailySendCeiling: number;
  maxSendsPerRun?: number;
  sendGapMs?: number;
  termsVersion: string;
  termsAcceptedAt: Date | null;
  termsAcceptedBy: string;
};

export function settingsFromRow(row: Row | null | undefined): CampaignSettings {
  if (!row) return { ...DEFAULT_CAMPAIGN_SETTINGS };
  return {
    enabled: row.enabled,
    adPrefixEnabled: row.adPrefixEnabled,
    adPrefixOffNote: row.adPrefixOffNote,
    adPrefixOffBy: row.adPrefixOffBy,
    adPrefixOffAt: row.adPrefixOffAt ? row.adPrefixOffAt.toISOString() : null,
    dailySendCeiling: row.dailySendCeiling,
    maxSendsPerRun: row.maxSendsPerRun ?? MAX_SENDS_PER_RUN,
    sendGapMs: row.sendGapMs ?? SEND_GAP_MS,
    termsVersion: row.termsVersion,
    termsAcceptedAt: row.termsAcceptedAt ? row.termsAcceptedAt.toISOString() : null,
    termsAcceptedBy: row.termsAcceptedBy,
  };
}
