import { loadInstanceConfig } from "@/lib/capability-instances";
import { prisma } from "@/lib/db";
import { documentApiKey, documentConfigFromStored } from "@/lib/flow/document-config";
import { smartNpvApiKey } from "./client-sync";
import { presignedUrlStale, uploadDay } from "./file-types";
import { SMART_NPV_HOST, smartClientFor } from "./smart-npv";

type StoredDownload = {
  id: string;
  tenantId: string;
  dossierId: string;
  remoteId: string;
  filename: string;
  downloadUrl: string | null;
  createdAt: Date;
};

/**
 * The link to open now. A stored S3 signature lasts about fifteen minutes,
 * so a stale one is replaced from today's upload list before the browser follows it.
 */
export async function currentDownloadUrl(doc: StoredDownload): Promise<string | null> {
  const stored = doc.downloadUrl?.startsWith("https://") ? doc.downloadUrl : "";
  if (!stored) return null;
  if (!presignedUrlStale(stored)) return stored;
  if (!doc.remoteId || doc.remoteId.startsWith("local:")) return null;
  try {
    const raw = await loadInstanceConfig({ tenantId: doc.tenantId, capabilityId: "documents" });
    const config = documentConfigFromStored({ ...raw, baseUrl: SMART_NPV_HOST });
    const apiKey = (await smartNpvApiKey(doc.tenantId)) || (config.apiKeyEnc ? documentApiKey(config) : "");
    if (!apiKey) return null;
    const dossier = await prisma.dossier.findFirst({
      where: { id: doc.dossierId, tenantId: doc.tenantId },
      select: { smartClientId: true },
    });
    if (!dossier?.smartClientId) return null;
    const client = smartClientFor({ baseUrl: config.baseUrl, apiKey });
    if (!client.listUploads) return null;
    const names = new Set([doc.remoteId, doc.filename].filter(Boolean));
    const days = [...new Set([uploadDay(doc.createdAt), uploadDay(new Date())])];
    for (const day of days) {
      const listed = await client.listUploads(dossier.smartClientId, day);
      const match = listed.find((item) => names.has(item.fileName));
      if (!match) continue;
      await prisma.leadDocument.updateMany({
        where: { id: doc.id, tenantId: doc.tenantId },
        data: { downloadUrl: match.downloadUrl },
      });
      return match.downloadUrl;
    }
  } catch {
    console.warn(JSON.stringify({ msg: "documents.link_refresh_failed", docId: doc.id }));
    return null;
  }
  console.warn(JSON.stringify({ msg: "documents.link_refresh_miss", docId: doc.id }));
  return null;
}
