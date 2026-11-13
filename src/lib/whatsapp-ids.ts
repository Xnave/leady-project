/**
 * A WhatsApp sender id in both forms we may hold it in ("+9725…" and "9725…"),
 * the given form first. Anything that is not a bare phone stays as it is.
 */
export function whatsappExternalIdVariants(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) return [];
  if (!/^\+?\d{8,15}$/.test(trimmed)) return [trimmed];
  const digits = trimmed.replace(/^\+/, "");
  return trimmed.startsWith("+") ? [trimmed, digits] : [trimmed, `+${digits}`];
}
