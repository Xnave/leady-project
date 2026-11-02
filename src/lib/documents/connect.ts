import { loadInstanceConfig } from "@/lib/capability-instances";
import { documentApiKey, parseDocumentConfig } from "@/lib/flow/document-config";
import { smartClientFor } from "./smart-npv";

/** Lookup a phone with the saved connection, or with the key the form is about to save. */
export async function testDocumentsConnection(opts: {
  tenantId: string;
  baseUrl?: string;
  apiKey?: string;
  phone?: string;
}): Promise<boolean> {
  const existing = await loadInstanceConfig({ tenantId: opts.tenantId, capabilityId: "documents" });
  const config = parseDocumentConfig(
    {
      baseUrl: opts.baseUrl || (typeof existing.baseUrl === "string" ? existing.baseUrl : ""),
      apiKey: opts.apiKey || "",
      rules: existing.rules,
    },
    typeof existing.apiKeyEnc === "string" ? existing.apiKeyEnc : "",
  );
  const client = smartClientFor({ baseUrl: config.baseUrl, apiKey: documentApiKey(config) });
  const found = await client.findClient({ phone: opts.phone || "0500000000" });
  return Boolean(found);
}
