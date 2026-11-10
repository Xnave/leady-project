import { loadInstanceConfig } from "@/lib/capability-instances";
import { documentApiKey, parseDocumentConfig } from "@/lib/flow/document-config";
import { SMART_NPV_HOST, smartClientFor } from "./smart-npv";

/** Ask Smart NPV for one list row. A successful response means the key is accepted. */
export async function testDocumentsConnection(opts: {
  tenantId: string;
  apiKey?: string;
}): Promise<void> {
  const existing = await loadInstanceConfig({ tenantId: opts.tenantId, capabilityId: "documents" });
  const config = parseDocumentConfig(
    {
      baseUrl: SMART_NPV_HOST,
      apiKey: opts.apiKey || "",
      rules: existing.rules,
    },
    typeof existing.apiKeyEnc === "string" ? existing.apiKeyEnc : "",
  );
  const client = smartClientFor({ baseUrl: config.baseUrl, apiKey: documentApiKey(config) });
  await client.listClients({ limit: 1 });
}
