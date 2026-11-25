import type { TurnContext } from "./types";

const TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function readVar(vars: Record<string, string>, key: string): string {
  return vars[key] || vars[camel(key)] || vars[snake(key)] || "";
}

/** Lead fields an intro can insert. `name` is the customer's name, the same key as on the lead. */
export const INTRO_FIELD_TOKENS = ["name", "phone", "email"] as const;

const NAME_KEYS = ["name", "full_name", "fullName"] as const;

function stringFields(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.trim()) out[key] = item.trim();
  }
  return out;
}

function personName(fields: Record<string, string>): string {
  return NAME_KEYS.map((key) => fields[key]).find(Boolean) ?? "";
}

/** Replace `{{name}}` and drop an empty token without leaving a double space or a stray comma. */
export function fillIntro(template: string, vars: Record<string, string>): string {
  return template
    .replace(TOKEN, (_, key: string) => readVar(vars, key))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.:;!?])/g, "$1")
    .replace(/^[ \t,.:;!?]+/gm, "")
    .trim();
}

/**
 * Lead strings, then the matched client fields, which win on the same key.
 * The customer's name is `name`. `full_name` and `fullName` are the same value.
 */
export function introVars(ctx: Partial<Pick<TurnContext, "lead" | "capabilityState">>): Record<string, string> {
  const lead = stringFields(ctx.lead?.fields);
  const documents = ctx.capabilityState?.documents;
  const client = stringFields(isRecord(documents) ? documents.introFields : undefined);
  const vars = { ...lead, ...client };
  const name = personName(client) || personName(lead);
  if (name) {
    vars.name = name;
    vars.full_name = name;
    vars.fullName = name;
  }
  return vars;
}
