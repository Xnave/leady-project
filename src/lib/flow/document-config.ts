import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
import { SMART_NPV_HOST } from "@/lib/documents/smart-npv";
import { parseRules, type RulesDocument } from "@/lib/documents/rules";
import { FlowConfigError } from "@/lib/flow/types";

export type DocumentConfig = {
  baseUrl: string;
  /** AES-GCM payload from encryptSecret. Empty when the tenant is in test mode. */
  apiKeyEnc: string;
  /** Digits the owner listed. These leads never call Smart NPV, even when a key exists. */
  testPhones: string[];
  /** True when no key is stored. Files stay in the CRM. */
  testOnly: boolean;
  /** Rejected uploads on one slot before a cool-off. Default 5. */
  maxRejectTries: number;
  /** Minutes to wait after the try limit before the customer can send that file again. Default 5. */
  rejectCooldownMinutes: number;
  /** First message when the phone is not in the client table. Empty uses the short default. */
  unrecognizedIntro: string;
  rules: RulesDocument;
  /** Owner switch: message new source clients first. Default off. */
  autoInvite: boolean;
  /** ISO time the switch last went on. Only contacts stored after it are invited. */
  autoInviteOnAt: string;
  /** `{{2}}` in the invite templates, e.g. "ליאור - לייבל משכנתאות". Nothing is sent while empty. */
  clientDisplayName: string;
  /** ISO time the test phone list was last emptied. Contacts stored before it are not invited. */
  testModeEndedAt: string;
};

const DISPLAY_NAME_MAX = 60;

function isoOrEmpty(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString();
}

export const DEFAULT_MAX_REJECT_TRIES = 5;
export const DEFAULT_REJECT_COOLDOWN_MINUTES = 5;

function clampedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Empty uses the Smart NPV host. Any other host, including fake:, is rejected. */
export function officialSmartHost(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "").replace(/\/api\/v2$/i, "");
  if (!trimmed || trimmed.toLowerCase() === SMART_NPV_HOST) return SMART_NPV_HOST;
  return "";
}

function phoneList(value: unknown, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const item of raw) {
    const phone = String(item).trim();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8 || seen.has(digits)) continue;
    seen.add(digits);
    phones.push(phone);
  }
  return phones;
}

/**
 * An enabled documents instance needs a base URL and rules the engine can run.
 * A missing key is allowed: the tenant stays in test mode and files are not sent to Smart NPV.
 * `existingKeyEnc` keeps the stored key when the form leaves the field blank.
 */
export function parseDocumentConfig(
  raw: unknown,
  existingKeyEnc = "",
  existingTestPhones: string[] = [],
  existingUnrecognizedIntro = "",
  /** The stored config. Invite settings the body leaves out are kept; the stamps only ever come from here. */
  existing: Record<string, unknown> = {},
): DocumentConfig {
  const errors: string[] = [];
  const body = isRecord(raw) ? raw : {};
  const baseUrl = officialSmartHost(typeof body.baseUrl === "string" ? body.baseUrl : "");
  if (!baseUrl) errors.push("baseUrl must be https://www.snpv.co.il");
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  let apiKeyEnc = existingKeyEnc;
  if (apiKey) {
    try {
      apiKeyEnc = encryptSecret(apiKey);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "api key could not be stored");
    }
  }
  const testPhones = phoneList(body.testPhones, existingTestPhones);
  const maxRejectTries = clampedInt(body.maxRejectTries, DEFAULT_MAX_REJECT_TRIES, 1, 20);
  const rejectCooldownMinutes = clampedInt(
    body.rejectCooldownMinutes,
    DEFAULT_REJECT_COOLDOWN_MINUTES,
    1,
    1440,
  );
  const unrecognizedIntro = (
    typeof body.unrecognizedIntro === "string" ? body.unrecognizedIntro : existingUnrecognizedIntro
  )
    .trim()
    .slice(0, 1000);

  let rules: RulesDocument = MORTGAGE_RULES;
  if (body.rules !== undefined) {
    try {
      const parsed = typeof body.rules === "string" ? JSON.parse(body.rules) as unknown : body.rules;
      rules = parseRules(parsed);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "rules are invalid");
    }
  }

  const autoInvite = typeof body.autoInvite === "boolean" ? body.autoInvite : existing.autoInvite === true;
  const clientDisplayName = (
    typeof body.clientDisplayName === "string"
      ? body.clientDisplayName
      : typeof existing.clientDisplayName === "string"
        ? existing.clientDisplayName
        : ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_NAME_MAX);

  if (errors.length) throw new FlowConfigError(errors);
  return {
    baseUrl,
    apiKeyEnc,
    testPhones,
    testOnly: !apiKeyEnc,
    maxRejectTries,
    rejectCooldownMinutes,
    unrecognizedIntro,
    rules,
    autoInvite,
    autoInviteOnAt: isoOrEmpty(existing.autoInviteOnAt),
    clientDisplayName,
    testModeEndedAt: isoOrEmpty(existing.testModeEndedAt),
  };
}

/** Invites go only to the test phones while the owner lists any. */
export function inviteTestMode(config: Pick<DocumentConfig, "testPhones">): boolean {
  return config.testPhones.length > 0;
}

/**
 * Stamp the moments that bound the invite backlog: the switch going on, and
 * the test phone list being emptied. `prev` is the stored config before this save.
 */
export function applyInviteSettings(prev: DocumentConfig | null, next: DocumentConfig, now: Date): DocumentConfig {
  const wasOn = prev?.autoInvite === true;
  const wasTesting = prev ? inviteTestMode(prev) : false;
  return {
    ...next,
    autoInviteOnAt: next.autoInvite ? (wasOn && next.autoInviteOnAt ? next.autoInviteOnAt : now.toISOString()) : "",
    testModeEndedAt: wasTesting && !inviteTestMode(next) ? now.toISOString() : next.testModeEndedAt,
  };
}

/** Contacts stored after this moment may be invited. Null when the switch is off. */
export function inviteCutoff(config: DocumentConfig): Date | null {
  if (!config.autoInvite || !config.autoInviteOnAt) return null;
  const on = new Date(config.autoInviteOnAt);
  if (inviteTestMode(config) || !config.testModeEndedAt) return on;
  const ended = new Date(config.testModeEndedAt);
  return ended > on ? ended : on;
}

/** Read a row already stored on the capability instance. The key lives in `apiKeyEnc`, not `apiKey`. */
export function documentConfigFromStored(raw: unknown): DocumentConfig {
  const body = isRecord(raw) ? raw : {};
  const phones = Array.isArray(body.testPhones)
    ? body.testPhones.filter((item): item is string => typeof item === "string")
    : [];
  return parseDocumentConfig(body, typeof body.apiKeyEnc === "string" ? body.apiKeyEnc : "", phones, "", body);
}

export function documentApiKey(config: DocumentConfig): string {
  if (!config.apiKeyEnc) throw new Error("documents key missing");
  return decryptSecret(config.apiKeyEnc);
}

/** A lead in test mode never calls Smart NPV. Keyless tenants are always in test mode. */
export function isTestLead(config: Pick<DocumentConfig, "apiKeyEnc" | "testPhones">, phone: string): boolean {
  if (!config.apiKeyEnc) return true;
  const needle = phone.replace(/\D/g, "");
  if (needle.length < 8) return false;
  const tail = needle.slice(-9);
  return config.testPhones.some((item) => {
    const digits = item.replace(/\D/g, "");
    return digits.length >= 8 && (digits.endsWith(tail) || needle.endsWith(digits.slice(-9)));
  });
}

/** What the settings form may see. The key itself stays encrypted. */
export function publicDocumentConfig(config: Record<string, unknown>): {
  baseUrl: string;
  hasKey: boolean;
  testOnly: boolean;
  testPhones: string[];
  maxRejectTries: number;
  rejectCooldownMinutes: number;
  unrecognizedIntro: string;
  rules: unknown;
  autoInvite: boolean;
  clientDisplayName: string;
} {
  const parsed = isRecord(config) ? config : {};
  const hasKey = typeof parsed.apiKeyEnc === "string" && parsed.apiKeyEnc.length > 0;
  const testPhones = Array.isArray(parsed.testPhones)
    ? parsed.testPhones.filter((item): item is string => typeof item === "string")
    : [];
  return {
    baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
    hasKey,
    testOnly: !hasKey,
    testPhones,
    maxRejectTries: clampedInt(parsed.maxRejectTries, DEFAULT_MAX_REJECT_TRIES, 1, 20),
    rejectCooldownMinutes: clampedInt(
      parsed.rejectCooldownMinutes,
      DEFAULT_REJECT_COOLDOWN_MINUTES,
      1,
      1440,
    ),
    unrecognizedIntro: typeof parsed.unrecognizedIntro === "string" ? parsed.unrecognizedIntro : "",
    rules: parsed.rules ?? MORTGAGE_RULES,
    autoInvite: parsed.autoInvite === true,
    clientDisplayName: typeof parsed.clientDisplayName === "string" ? parsed.clientDisplayName : "",
  };
}
