/**
 * Hourly import of Smart NPV clients created after the first run.
 * The first run only records today's date. Later runs keep rows whose
 * `created` date is after that day. No lead, dossier, or WhatsApp message.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { documentApiKey, parseDocumentConfig } from "@/lib/flow/document-config";
import type { Profile } from "./rules";
import { smartClientFor, toSmartPhone, type SmartClient } from "./smart-npv";

export const SYNC_PAGE = 100;

export type StoredClient = {
  smartClientId: string;
  phone1: string;
  phone2: string;
  profile: Profile;
  createdOn: string;
};

export type SyncDeps = {
  now: Date;
  cursorDate: string | null;
  client: SmartClient;
  alreadyStored: (smartClientId: string) => Promise<boolean>;
  saveCursor: (date: string) => Promise<void>;
  saveClient: (row: StoredClient) => Promise<void>;
};

export type SyncOutcome = {
  firstRun: boolean;
  imported: number;
  skipped: number;
  failed: number;
};

/** Calendar day in Asia/Jerusalem, YYYY-MM-DD. */
export function jerusalemDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Smart NPV list filters use DD/MM/YYYY. */
export function smartListDay(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

/** True when the list row's created date is strictly after the cursor day. */
export function createdAfter(createdOn: string, cursorDate: string): boolean {
  return Boolean(createdOn && cursorDate && createdOn > cursorDate);
}

/** Same 05… form stored on SmartNpvClient and used to match a WhatsApp sender. */
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

function asProfile(value: unknown): Profile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Profile;
}

/**
 * One tenant, one pass. A failed GET is counted and left unstored so the next
 * hour lists the same window and retries it. The cursor date does not move.
 */
export async function syncTenantClients(deps: SyncDeps): Promise<SyncOutcome> {
  const today = jerusalemDay(deps.now);
  if (!deps.cursorDate) {
    await deps.saveCursor(today);
    return { firstRun: true, imported: 0, skipped: 0, failed: 0 };
  }
  const from = smartListDay(deps.cursorDate);
  const until = smartListDay(today);
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let offset = 0;
  for (;;) {
    const page = await deps.client.listClients({
      limit: SYNC_PAGE,
      offset,
      rangeType: 1,
      from,
      until,
    });
    for (const row of page) {
      if (!createdAfter(row.createdOn, deps.cursorDate)) {
        skipped += 1;
        continue;
      }
      if (await deps.alreadyStored(row.clientId)) {
        skipped += 1;
        continue;
      }
      try {
        const full = await deps.client.findClient({ clientId: row.clientId });
        if (!full) {
          failed += 1;
          continue;
        }
        await deps.saveClient({
          smartClientId: full.clientId,
          phone1: full.phone1,
          phone2: full.phone2,
          profile: full.profile,
          createdOn: row.createdOn,
        });
        imported += 1;
      } catch {
        failed += 1;
      }
    }
    if (page.length < SYNC_PAGE) break;
    offset += page.length;
    if (offset > 5000) break;
  }
  return { firstRun: false, imported, skipped, failed };
}

export async function storedClientByPhone(tenantId: string, phone: string): Promise<StoredClient | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const row = await prisma.smartNpvClient.findFirst({
    where: { tenantId, OR: [{ phone1: key }, { phone2: key }] },
  });
  if (!row) return null;
  return {
    smartClientId: row.smartClientId,
    phone1: row.phone1,
    phone2: row.phone2,
    profile: asProfile(row.profile),
    createdOn: row.createdOn,
  };
}

/** Every documents tenant with a real API key. Test-only configs are skipped. */
export async function syncSmartNpvTenants(now = new Date()): Promise<Array<{ tenantId: string } & SyncOutcome>> {
  const instances = await prisma.capabilityInstance.findMany({
    where: { capabilityId: "documents", enabled: true },
    select: { tenantId: true, config: true },
  });
  const results: Array<{ tenantId: string } & SyncOutcome> = [];
  for (const row of instances) {
    let config;
    try {
      config = parseDocumentConfig(row.config);
    } catch {
      continue;
    }
    if (config.testOnly) continue;
    const apiKey = documentApiKey(config);
    if (!apiKey) continue;
    const sync = await prisma.smartNpvSync.findUnique({ where: { tenantId: row.tenantId } });
    const outcome = await syncTenantClients({
      now,
      cursorDate: sync?.cursorDate ?? null,
      client: smartClientFor({ baseUrl: config.baseUrl, apiKey }),
      alreadyStored: async (smartClientId) => {
        const existing = await prisma.smartNpvClient.findFirst({
          where: { tenantId: row.tenantId, smartClientId },
          select: { id: true },
        });
        return Boolean(existing);
      },
      saveCursor: async (date) => {
        await prisma.smartNpvSync.upsert({
          where: { tenantId: row.tenantId },
          create: { tenantId: row.tenantId, cursorDate: date, lastRunAt: now },
          update: { lastRunAt: now },
        });
      },
      saveClient: async (stored) => {
        await prisma.smartNpvClient.create({
          data: {
            tenantId: row.tenantId,
            smartClientId: stored.smartClientId,
            phone1: stored.phone1,
            phone2: stored.phone2,
            profile: stored.profile as Prisma.InputJsonValue,
            createdOn: stored.createdOn,
          },
        });
      },
    });
    if (!outcome.firstRun && sync) {
      await prisma.smartNpvSync.update({
        where: { tenantId: row.tenantId },
        data: { lastRunAt: now },
      });
    }
    results.push({ tenantId: row.tenantId, ...outcome });
    console.log(
      JSON.stringify({
        msg: "documents.client_sync",
        tenantId: row.tenantId,
        firstRun: outcome.firstRun,
        imported: outcome.imported,
        skipped: outcome.skipped,
        failed: outcome.failed,
      }),
    );
  }
  return results;
}
