import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
import { parseRules, type RulesDocument } from "@/lib/documents/rules";
import { FlowConfigError } from "@/lib/flow/types";

export type DocumentConfig = {
  baseUrl: string;
  /** AES-GCM payload from encryptSecret. Never the raw API key. */
  apiKeyEnc: string;
  rules: RulesDocument;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * An enabled documents instance needs a base URL, a key, and rules the engine can run.
 * `existingKeyEnc` keeps the stored key when the form leaves the field blank.
 */
export function parseDocumentConfig(raw: unknown, existingKeyEnc = ""): DocumentConfig {
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
  if (!apiKeyEnc) errors.push("apiKey is required");

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
  return { baseUrl, apiKeyEnc, rules };
}

export function documentApiKey(config: DocumentConfig): string {
  return decryptSecret(config.apiKeyEnc);
}

/** What the settings form may see. The key itself stays encrypted. */
export function publicDocumentConfig(config: Record<string, unknown>): {
  baseUrl: string;
  hasKey: boolean;
  rules: unknown;
} {
  const parsed = isRecord(config) ? config : {};
  return {
    baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
    hasKey: typeof parsed.apiKeyEnc === "string" && parsed.apiKeyEnc.length > 0,
    rules: parsed.rules ?? MORTGAGE_RULES,
  };
}
