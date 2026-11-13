import { looksLikePhoneNumber } from "@/lib/flow/phone";

/** Demo threads that stand in for a WhatsApp sender. The real number is never the lead id. */
export const DEMO_PHONE_PREFIX = "demo-phone-";

/** `demo-phone-` plus the digits the operator typed. Empty when it is not a phone. */
export function demoPhoneSender(raw: string): string {
  const trimmed = raw.trim();
  if (!looksLikePhoneNumber(trimmed)) return "";
  return `${DEMO_PHONE_PREFIX}${trimmed.replace(/\D/g, "")}`;
}

/** Digits stored after the demo prefix. Empty for every other sender, including live WhatsApp. */
export function phoneFromDemoSender(externalUserId: string): string {
  if (!externalUserId.startsWith(DEMO_PHONE_PREFIX)) return "";
  const digits = externalUserId.slice(DEMO_PHONE_PREFIX.length);
  return looksLikePhoneNumber(digits) ? digits : "";
}

/**
 * The number the documents match uses.
 * An impersonated demo sender and a WhatsApp-looking id win over a phone the model saved.
 */
export function senderPhone(externalUserId: string, fieldsPhone?: string): string {
  return (
    phoneFromDemoSender(externalUserId) ||
    (looksLikePhoneNumber(externalUserId) ? externalUserId.trim() : "") ||
    fieldsPhone?.trim() ||
    ""
  );
}

/** True when this thread must not be delivered to WhatsApp. Read from fields already on the turn. */
export function replyStaysHere(fields: { demoReplyHereOnly?: unknown }, externalUserId: string): boolean {
  return fields.demoReplyHereOnly === "1" || externalUserId.startsWith(DEMO_PHONE_PREFIX);
}
