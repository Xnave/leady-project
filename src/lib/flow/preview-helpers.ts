export function heuristicPreviewClassify(text: string, intents: string[]): string {
  const blob = text.toLowerCase();
  if (intents.includes("support") && /how|reset|broken|help|filter/.test(blob)) {
    return "support";
  }
  if (intents.includes("sales")) return "sales";
  return intents[0];
}

/** Ops preview has no LLM. Production extract uses the model. */
export function previewExtract(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) fields.email = email[0];
  const name = text.match(/(?:i(?:'|’)m|i am|my name is)\s+([A-Za-z][\p{L}' -]{0,40})/iu);
  if (name) fields.name = name[1].trim();
  const service = text.match(/\b(remodel|repair|install|consult)\b/i);
  if (service) fields.service = service[1].toLowerCase();
  return fields;
}
