/**
 * Per-instance vocabulary. What the business calls a request — "stay", "fitting",
 * "rental", "visit" — is tenant data, not code: `copy/` keeps the sentence
 * mechanics and an instance supplies the noun that slots into them.
 */
import type { FieldLang } from "./fields";

export type InstanceNoun = {
  singular: string;
  plural: string;
};

export type InstanceNounsByLang = Partial<Record<FieldLang, InstanceNoun>>;

/** Instance config shape: `{ nouns: { en: { singular, plural }, he: { … } } }`. */
export function parseInstanceNouns(raw: unknown): InstanceNounsByLang | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: InstanceNounsByLang = {};
  for (const lang of ["en", "he"] as const) {
    const entry = (raw as Record<string, unknown>)[lang];
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const singular = typeof o.singular === "string" ? o.singular.trim() : "";
    if (!singular) continue;
    const plural = typeof o.plural === "string" ? o.plural.trim() : "";
    out[lang] = { singular, plural: plural || singular };
  }
  return Object.keys(out).length ? out : undefined;
}

/** The configured noun for a language, falling back to the capability's default. */
export function nounFor(
  nouns: InstanceNounsByLang | undefined,
  lang: FieldLang,
  fallback: InstanceNoun,
): InstanceNoun {
  return nouns?.[lang] ?? fallback;
}
