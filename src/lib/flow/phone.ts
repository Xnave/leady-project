/**
 * Shared phone shape checks for booking / collect / inbound.
 * Rejects Instagram-style PSIDs (16+ digit ids) that match a naive digit regex.
 */

/** True for plausible phone numbers (E.164-ish), not chat platform user ids. */
export function looksLikePhoneNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+?\d[\d\s-]{7,}\d$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  // E.164 max 15; local IL mobiles are 9–10. PSIDs are often 16–17 digits.
  return digits.length >= 9 && digits.length <= 15;
}
