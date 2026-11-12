/**
 * Match a WhatsApp sender to a Smart NPV contact stored by the client-source sync.
 * The hourly import lives on ClientSource, not here.
 */
import { decryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getConnector } from "@/lib/client-sources/registry";
import { normalizeClientPhone } from "@/lib/client-sources/phone";
import type { Profile } from "./rules";
import { createdDay, toSmartPhone } from "./smart-npv";

export type StoredClient = {
  smartClientId: string;
  phone1: string;
  phone2: string;
  profile: Profile;
  createdOn: string;
};

/** Same 05… form used to match a borrower phone on the checklist. */
export function phoneKey(raw: string): string {
  return toSmartPhone(raw);
}

export function matchesStoredPhone(
  row: { phone1: string; phone2: string },
  phone: string,
): boolean {
  const key = phoneKey(phone);
  if (!key) return false;
  return row.phone1 === key || row.phone2 === key;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asProfile(value: unknown): Profile {
  return asRecord(value) as Profile;
}

/** Phone keys the Smart NPV connector marks, besides the primary column. */
function extraPhoneKeys(): string[] {
  const catalog = getConnector("smartnpv")?.fieldCatalog ?? [];
  const marked = catalog.filter((field) => field.phoneKey).map((field) => field.key);
  return (marked.length ? marked : ["phone_2"]).filter((key) => key !== "phone_1");
}

/** The key saved on the tenant's Smart NPV source. Empty when that source has none. */
export async function smartNpvApiKey(tenantId: string): Promise<string> {
  try {
    const row = await prisma.clientSource.findFirst({
      where: { tenantId, kind: "smartnpv" },
      select: { credentialsEnc: true },
    });
    if (!row?.credentialsEnc) return "";
    const parsed = JSON.parse(decryptSecret(row.credentialsEnc)) as { apiKey?: unknown };
    return typeof parsed.apiKey === "string" ? parsed.apiKey : "";
  } catch {
    return "";
  }
}

/** The stored Smart NPV contact for this sender, matched on the primary phone and mapped phone keys. */
export async function storedClientByPhone(tenantId: string, phone: string): Promise<StoredClient | null> {
  const normalized = normalizeClientPhone(phone, "972");
  if (normalized.status !== "ok") return null;
  const key = normalized.phone;
  const row = await prisma.contact.findFirst({
    where: {
      tenantId,
      source: { kind: "smartnpv" },
      OR: [
        { phone: key },
        ...extraPhoneKeys().map((name) => ({ mapped: { path: [name], equals: key } })),
      ],
    },
    select: { externalId: true, phone: true, mapped: true },
  });
  if (!row) return null;
  const mapped = asRecord(row.mapped);
  return {
    smartClientId: row.externalId,
    phone1: typeof mapped.phone_1 === "string" ? mapped.phone_1 : row.phone,
    phone2: typeof mapped.phone_2 === "string" ? mapped.phone_2 : "",
    profile: asProfile(mapped.checklist),
    createdOn: createdDay(mapped.created),
  };
}
