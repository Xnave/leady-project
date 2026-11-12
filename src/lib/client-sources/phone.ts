export type NormalizedPhone = { phone: string; status: "ok" | "missing" | "invalid" };

/**
 * Digits with country code and no "+", the form Zernio sends to and the form
 * WhatsApp leads are stored under. Local numbers ("050-1234567") get the
 * source's default country code. Anything that cannot be a phone is "invalid".
 */
export function normalizeClientPhone(raw: unknown, defaultCountryCode: string): NormalizedPhone {
  const text = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!text) return { phone: "", status: "missing" };
  let digits = text.replace(/\D/g, "");
  if (!digits) return { phone: "", status: "invalid" };
  const cc = defaultCountryCode.replace(/\D/g, "");
  if (text.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && cc) {
    digits = `${cc}${digits.slice(1)}`;
  } else if (cc && !digits.startsWith(cc) && digits.length <= 9) {
    // "501234567": a local number with its leading 0 dropped by a spreadsheet
    digits = `${cc}${digits}`;
  }
  if (digits.length < 10 || digits.length > 15) return { phone: "", status: "invalid" };
  // Israel: 972 + 8 or 9 digits, no leading 0 after the country code.
  if (digits.startsWith("972") && !/^972[1-9]\d{7,8}$/.test(digits)) return { phone: "", status: "invalid" };
  return { phone: digits, status: "ok" };
}
