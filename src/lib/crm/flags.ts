import { rapidDemoWhatsAppNumber } from "@/lib/rapid-demo/guards";

/** Global kill switch for the WhatsApp daily digest (the tenant also opts in via `Tenant.digestEnabled`). */
export function digestFeatureOn(): boolean {
  return process.env["DIGEST_WHATSAPP_ENABLED"] === "true";
}

/**
 * The number the digest is sent from. Defaults to the shared Zapidly number
 * (`RAPID_DEMO_WHATSAPP_*`), which is also a tenant channel - so digest
 * handling only claims inbound from known owners (see `handleDigestReply`).
 */
export function digestPlatformNumber(): string {
  return (process.env["DIGEST_WHATSAPP_NUMBER"] || rapidDemoWhatsAppNumber()).replace(/\D/g, "");
}
