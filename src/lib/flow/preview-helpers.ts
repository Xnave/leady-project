export function heuristicPreviewClassify(text: string, intents: string[]): string {
  const blob = text.toLowerCase();
  if (intents.includes("support") && /how|reset|broken|help|filter/.test(blob)) {
    return "support";
  }
  if (intents.includes("sales")) return "sales";
  return intents[0];
}
