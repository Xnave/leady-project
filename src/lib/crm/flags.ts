/** CRM v2 is on for a tenant when its own flag is set, or for everyone via `CRM_V2_ALL=true`. */
export function crmV2Enabled(tenant: { crmV2: boolean }): boolean {
  return tenant.crmV2 || process.env["CRM_V2_ALL"] === "true";
}

/** Global kill switch for the WhatsApp daily digest (the tenant also opts in via `Tenant.digestEnabled`). */
export function digestFeatureOn(): boolean {
  return process.env["DIGEST_WHATSAPP_ENABLED"] === "true";
}
