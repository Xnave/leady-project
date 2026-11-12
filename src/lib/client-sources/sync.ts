import { normalizeClientPhone } from "./phone";
import {
  ConnectorAuthError,
  SessionExpiredError,
  type AnyClientConnector,
  type BaseSourceConfig,
  type ClientRecord,
  type DealDate,
} from "./types";

/**
 * Generic client sync: pages a connector, normalizes phones, derives fields and
 * hands rows to a store. It only writes `Contact` rows (through the store);
 * it has no way to create a Lead, so syncing never touches the pipeline.
 */

export type ContactUpsert = {
  externalId: string;
  phone: string;
  phoneStatus: "ok" | "missing" | "invalid";
  name: string;
  /** Catalog columns, checklist facts, and phone keys. */
  mapped: Record<string, unknown>;
  /** The CRM row, or {} when storeRaw is off. */
  raw: Record<string, unknown>;
  dealDate: DealDate;
  sourceUpdatedAt: Date | null;
  /** Existing Lead with the same phone, if any. Never cleared by a later sync. */
  leadId: string | null;
};

export type SyncStore = {
  /** Upsert on (tenant, source, externalId). Returns how many rows were new. */
  upsertContacts(rows: ContactUpsert[]): Promise<{ created: number; updated: number }>;
  /** Lead ids by normalized phone, for this tenant only. */
  leadIdsByPhone(phones: string[]): Promise<Map<string, string>>;
  /** Which of these external ids are already stored for this source. */
  existingExternalIds(externalIds: string[]): Promise<Set<string>>;
};

export type SyncCounts = {
  fetched: number;
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  /** New clients that failed the keep rules, so they were not stored. */
  outOfScope: number;
  noPhone: number;
  invalidPhone: number;
  linkedLeads: number;
  pages: number;
};

export function emptyCounts(): SyncCounts {
  return { fetched: 0, synced: 0, created: 0, updated: 0, skipped: 0, outOfScope: 0, noPhone: 0, invalidPhone: 0, linkedLeads: 0, pages: 0 };
}

export function addCounts(a: SyncCounts, b: SyncCounts): SyncCounts {
  const out = emptyCounts();
  for (const key of Object.keys(out) as (keyof SyncCounts)[]) out[key] = a[key] + b[key];
  return out;
}

function fieldText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export function isSkipped(record: ClientRecord, config: BaseSourceConfig): boolean {
  return config.skip.some((rule) => rule.in.includes(fieldText(record.fields[rule.field])));
}

function yearsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/** True when the client passes every keep rule that is set. No rules = everyone is kept. */
export function isKept(fields: Record<string, unknown>, dealDate: DealDate, config: BaseSourceConfig, now: Date): boolean {
  const keep = config.keep ?? { fields: [] };
  for (const rule of keep.fields) {
    if (rule.in.length && !rule.in.includes(fieldText(fields[rule.field]))) return false;
  }
  const window = keep.dealYearsAgo;
  if (window && (window.min != null || window.max != null)) {
    if (!dealDate.date) return false;
    const years = yearsBetween(dealDate.date, now);
    if (window.min != null && years < window.min) return false;
    if (window.max != null && years > window.max) return false;
  }
  return true;
}

/**
 * Turn connector records into rows for the store. Pure, so it is easy to test.
 * `outOfScope` holds rows that failed the keep rules: the sync stores them only
 * when they already exist (a stored client is never dropped, it keeps updating).
 */
export function prepareContacts(
  connector: AnyClientConnector,
  config: BaseSourceConfig,
  records: ClientRecord[],
  now: Date,
): { rows: ContactUpsert[]; outOfScope: ContactUpsert[]; counts: SyncCounts } {
  const counts = emptyCounts();
  const rows: ContactUpsert[] = [];
  const outOfScope: ContactUpsert[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    counts.fetched += 1;
    if (seen.has(record.externalId)) continue;
    seen.add(record.externalId);
    if (isSkipped(record, config)) {
      counts.skipped += 1;
      continue;
    }
    const phone = normalizeClientPhone(record.phone, config.defaultCountryCode);
    if (phone.status === "missing") counts.noPhone += 1;
    if (phone.status === "invalid") counts.invalidPhone += 1;
    const derived = connector.derive(record, config, now);
    const mapped = { ...record.fields, ...derived.fields };
    const row: ContactUpsert = {
      externalId: record.externalId,
      phone: phone.phone,
      phoneStatus: phone.status,
      name: record.name.slice(0, 200),
      mapped,
      raw: config.storeRaw && record.raw ? record.raw : {},
      dealDate: derived.dealDate,
      sourceUpdatedAt: record.updatedAt,
      leadId: null,
    };
    (isKept(mapped, derived.dealDate, config, now) ? rows : outOfScope).push(row);
  }
  return { rows, outOfScope, counts };
}

/**
 * Caches one session per source while a process is warm, and re-authenticates
 * when the connector reports it expired or its TTL has passed.
 */
export class SessionCache {
  private sessions = new Map<string, { session: unknown; expiresAt: number | null }>();

  async get(key: string, connector: AnyClientConnector, credentials: unknown, config: BaseSourceConfig, now = Date.now()) {
    const hit = this.sessions.get(key);
    if (hit && (hit.expiresAt == null || hit.expiresAt > now)) return hit.session;
    const session = await connector.authenticate(credentials, config);
    const ttl = connector.sessionTtlSeconds;
    this.sessions.set(key, { session, expiresAt: ttl == null ? null : now + ttl * 1000 });
    return session;
  }

  drop(key: string) {
    this.sessions.delete(key);
  }
}

export const sharedSessionCache = new SessionCache();

export type SyncPageInput = {
  /** Cache key for the session, usually the source id. */
  key: string;
  connector: AnyClientConnector;
  credentials: unknown;
  config: BaseSourceConfig;
  store: SyncStore;
  cursor: string | null;
  updatedSince: Date | null;
  /** Lower bound for this source. The connector decides how much of it to use. */
  syncSince?: Date | null;
  now: Date;
  sessions?: SessionCache;
  /** Fetch and count, write nothing. */
  dryRun?: boolean;
};

export type SyncPageResult = { counts: SyncCounts; nextCursor: string | null; fieldKeys: string[] };

/** One page: fetch, prepare, link leads by phone, upsert. A durable step can wrap exactly this. */
export async function syncPage(input: SyncPageInput): Promise<SyncPageResult> {
  const sessions = input.sessions ?? sharedSessionCache;
  const fetchOnce = async () => {
    const session = await sessions.get(input.key, input.connector, input.credentials, input.config);
    return input.connector.fetchClients(session, input.config, {
      cursor: input.cursor,
      updatedSince: input.updatedSince,
      syncSince: input.syncSince ?? null,
    });
  };
  let page;
  try {
    page = await fetchOnce();
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) throw err;
    sessions.drop(input.key);
    page = await fetchOnce();
  }

  const prepared = prepareContacts(input.connector, input.config, page.clients, input.now);
  const { counts } = prepared;
  const rows = prepared.rows;
  counts.pages = 1;
  if (prepared.outOfScope.length) {
    // Already stored clients stay and keep updating; only new ones are left out.
    const known = await input.store.existingExternalIds(prepared.outOfScope.map((r) => r.externalId));
    for (const row of prepared.outOfScope) {
      if (known.has(row.externalId)) rows.push(row);
      else counts.outOfScope += 1;
    }
  }
  const fieldKeys = [...new Set(page.clients.flatMap((c) => Object.keys(c.fields)))].sort();

  const phones = [...new Set(rows.filter((r) => r.phone).map((r) => r.phone))];
  const leads = phones.length ? await input.store.leadIdsByPhone(phones) : new Map<string, string>();
  for (const row of rows) {
    const leadId = row.phone ? leads.get(row.phone) : undefined;
    if (leadId) {
      row.leadId = leadId;
      counts.linkedLeads += 1;
    }
  }

  if (!input.dryRun && input.config.freezeAfterFirstSync && rows.length) {
    const known = await input.store.existingExternalIds(rows.map((row) => row.externalId));
    const fresh = rows.filter((row) => !known.has(row.externalId));
    counts.skipped += rows.length - fresh.length;
    rows.length = 0;
    rows.push(...fresh);
  }
  counts.synced = rows.length;
  if (!input.dryRun && rows.length) {
    const written = await input.store.upsertContacts(rows);
    counts.created = written.created;
    counts.updated = written.updated;
  }
  return { counts, nextCursor: page.nextCursor, fieldKeys };
}

/** Every page in one go: tests, the inline fallback, and the admin test (with maxPages: 1). */
export async function runSync(
  input: Omit<SyncPageInput, "cursor"> & { maxPages?: number },
): Promise<{ counts: SyncCounts; complete: boolean; fieldKeys: string[] }> {
  let counts = emptyCounts();
  let cursor: string | null = null;
  const keys = new Set<string>();
  const maxPages = input.maxPages ?? 10_000;
  for (let i = 0; i < maxPages; i++) {
    const page = await syncPage({ ...input, cursor });
    counts = addCounts(counts, page.counts);
    page.fieldKeys.forEach((k) => keys.add(k));
    cursor = page.nextCursor;
    if (!cursor) return { counts, complete: true, fieldKeys: [...keys].sort() };
  }
  return { counts, complete: false, fieldKeys: [...keys].sort() };
}

/** Error text safe to store and show: secret values are masked, length is capped. */
export function safeErrorMessage(err: unknown, secrets: string[]): string {
  let message = err instanceof ConnectorAuthError ? `auth: ${err.message}` : err instanceof Error ? err.message : String(err);
  for (const secret of secrets) {
    if (secret && secret.length >= 4) message = message.split(secret).join("***");
  }
  message = message.replace(/api_key=[^&\s]+/gi, "api_key=***");
  return message.slice(0, 500);
}

/** Every string value in a credentials object, for masking. */
export function credentialSecrets(credentials: unknown): string[] {
  if (!credentials || typeof credentials !== "object") return [];
  return Object.values(credentials as Record<string, unknown>).filter((v): v is string => typeof v === "string");
}
