import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
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
  rules: RulesDocument;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
): DocumentConfig {
  const errors: string[] = [];
  const body = isRecord(raw) ? raw : {};
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  if (!baseUrl) errors.push("baseUrl is required");
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

  let rules: RulesDocument = MORTGAGE_RULES;
  if (body.rules !== undefined) {
    try {
      const parsed = typeof body.rules === "string" ? JSON.parse(body.rules) as unknown : body.rules;
      rules = parseRules(parsed);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "rules are invalid");
    }
  }

  if (errors.length) throw new FlowConfigError(errors);
  return { baseUrl, apiKeyEnc, testPhones, testOnly: !apiKeyEnc, rules };
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
  rules: unknown;
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
    rules: parsed.rules ?? MORTGAGE_RULES,
  };
}
