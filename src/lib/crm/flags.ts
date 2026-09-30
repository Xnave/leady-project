/** Global kill switch for the WhatsApp daily digest (the tenant also opts in via `Tenant.digestEnabled`). */
export function digestFeatureOn(): boolean {
  return process.env["DIGEST_WHATSAPP_ENABLED"] === "true";
}
