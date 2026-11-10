import { z } from "zod";
import { fetchSmartClientList, SmartNpvAuthError } from "@/lib/documents/smart-npv";
import { baseConfigSchema, dealDateStepSchema } from "./config";
import { deriveDealDate, parseClientDate, type DealDateStep } from "./dates";
import {
  ConnectorAuthError,
  type BaseSourceConfig,
  type ClientConnector,
  type ClientFieldDef,
  type ClientRecord,
} from "./types";

/**
 * Smart NPV (any tenant on it). HTTP lives in `src/lib/documents/smart-npv.ts`,
 * the one module that talks to Smart NPV and only to its official host.
 * Auth is one static api_key per account, so `authenticate` only checks it is
 * there; a bad key surfaces on the first `clients/list`.
 *
 * The key is read from the documents capability when the tenant has one there
 * (`sharedCredentials`), so a tenant keeps one Smart NPV key in one place.
 *
 * Every `clients/list` row is the full client payload (100+ fields); we keep
 * only the catalog below and never store id numbers, birthdays, income or amounts.
 */

/** Default ladder from the client-campaigns design. Tenants override it in config. */
export const SMARTNPV_DEFAULT_DEAL_DATE: DealDateStep[] = [
  { field: "last_date_execution", offsetMonths: 0, confidence: "high" },
  // Statuses that mean "deal completed" are tenant-specific; empty = this rung is off.
  { field: "archive_time", offsetMonths: 0, confidence: "medium_high", whenField: "status_id", whenIn: [] },
  { field: "client_contract_date", offsetMonths: 3, confidence: "medium" },
  { field: "last_documentation", offsetMonths: 0, confidence: "medium" },
  { field: "created", offsetMonths: 3, confidence: "low" },
];

const credentialsSchema = z.object({ apiKey: z.string().trim().min(8) });
export type SmartNpvCredentials = z.infer<typeof credentialsSchema>;

const configSchema = baseConfigSchema.extend({
  pageSize: z.number().int().min(10).max(500).default(100),
  /** Pause between pages, to stay polite to the CRM. */
  pageDelayMs: z.number().int().min(0).max(5000).default(300),
  dealDate: z.array(dealDateStepSchema).min(1).default(SMARTNPV_DEFAULT_DEAL_DATE),
});
export type SmartNpvConfig = z.infer<typeof configSchema> & BaseSourceConfig;

type SmartNpvSession = { apiKey: string; fetchImpl: typeof fetch };

const L = (he: string, en: string) => ({ he, en });

export const SMARTNPV_FIELDS: ClientFieldDef[] = [
  { key: "transaction_bank", label: L("בנק", "Bank"), type: "text", agentVisible: true, listColumn: true },
  { key: "status_id", label: L("סטטוס (קוד)", "Status id"), type: "text", agentVisible: false, listColumn: true },
  { key: "status_title", label: L("סטטוס", "Status"), type: "text", agentVisible: false },
  { key: "transaction_type", label: L("סוג עסקה (קוד)", "Transaction type"), type: "text", agentVisible: false },
  { key: "archive", label: L("בארכיון", "Archived"), type: "flag", agentVisible: false, listColumn: true },
  { key: "archive_time", label: L("תאריך ארכוב", "Archived on"), type: "date", agentVisible: false },
  { key: "last_date_execution", label: L("תאריך ביצוע", "Execution date"), type: "date", agentVisible: false },
  { key: "client_contract_date", label: L("תאריך הסכם", "Fee agreement date"), type: "date", agentVisible: false },
  { key: "last_documentation", label: L("מסמך אחרון", "Last document"), type: "date", agentVisible: false },
  { key: "created", label: L("נפתח", "Opened"), type: "date", agentVisible: false },
  { key: "modified", label: L("עודכן", "Modified"), type: "date", agentVisible: false },
  { key: "deal_year", label: L("שנת עסקה", "Deal year"), type: "number", agentVisible: true, derived: true },
];

const RAW_KEYS = SMARTNPV_FIELDS.filter((f) => !f.derived).map((f) => f.key);

function text(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Map one `clients/list` row. Returns null when the row has no uuid. */
export function mapSmartNpvRow(row: Record<string, unknown>): ClientRecord | null {
  const externalId = text(row.uuid);
  if (!externalId) return null;
  const fields: Record<string, unknown> = {};
  for (const key of RAW_KEYS) {
    const value = row[key];
    if (value == null) continue;
    const t = text(value);
    if (t) fields[key] = t;
  }
  const name = `${text(row.firstname_1)} ${text(row.lastname_1)}`.trim();
  const updatedAt = parseClientDate(row.modified) ?? parseClientDate(row.created);
  return { externalId, phone: text(row.phone_1), name, fields, updatedAt };
}

export function createSmartNpvConnector(opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): ClientConnector<
  SmartNpvCredentials,
  SmartNpvSession,
  SmartNpvConfig
> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    kind: "smartnpv",
    label: L("Smart NPV", "Smart NPV"),
    credentialsSchema,
    credentialFields: [{ key: "apiKey", label: L("מפתח API", "API key"), secret: true }],
    parseConfig: (raw) => configSchema.parse(raw ?? {}) as SmartNpvConfig,
    sessionTtlSeconds: null,
    fieldCatalog: SMARTNPV_FIELDS,
    archivedField: "archive",

    async sharedCredentials(tenantId) {
      // Dynamic: keeps the connector importable in unit tests without a DB.
      const { loadInstanceConfig } = await import("@/lib/capability-instances");
      const { decryptSecret } = await import("@/lib/crypto");
      const docs = await loadInstanceConfig({ tenantId, capabilityId: "documents" });
      const enc = typeof docs.apiKeyEnc === "string" ? docs.apiKeyEnc : "";
      return enc ? { apiKey: decryptSecret(enc) } : null;
    },

    async authenticate(credentials) {
      const parsed = credentialsSchema.safeParse(credentials);
      if (!parsed.success) throw new ConnectorAuthError("missing_api_key");
      return { apiKey: parsed.data.apiKey, fetchImpl: opts.fetchImpl ?? fetch };
    },

    async fetchClients(session, config, { cursor, updatedSince }) {
      const offset = cursor ? Number(cursor) : 0;
      if (!Number.isFinite(offset) || offset < 0) throw new Error("bad_cursor");
      if (offset > 0 && config.pageDelayMs > 0) await sleep(config.pageDelayMs);
      // The API filters by day; step back one so an edit late on the last sync day is not missed.
      const from = updatedSince ? new Date(updatedSince.getTime() - 24 * 3600 * 1000) : new Date(Date.UTC(2000, 0, 1));
      let page;
      try {
        page = await fetchSmartClientList({
          apiKey: session.apiKey,
          fetchImpl: session.fetchImpl,
          query: {
            rangeType: updatedSince ? 2 : 1,
            from: ddmmyyyy(from),
            until: ddmmyyyy(new Date(Date.now() + 24 * 3600 * 1000)),
            limit: config.pageSize,
            offset,
          },
        });
      } catch (err) {
        if (err instanceof SmartNpvAuthError) throw new ConnectorAuthError(`smartnpv: ${err.message}`);
        throw err;
      }
      const { rows, total } = page;
      const clients = rows.map(mapSmartNpvRow).filter((c): c is ClientRecord => c !== null);
      const seen = offset + rows.length;
      const more = rows.length >= config.pageSize && (total == null || seen < total);
      return { clients, nextCursor: more ? String(seen) : null };
    },

    derive(record, config) {
      const dealDate = deriveDealDate(record.fields, config.dealDate);
      const fields: Record<string, unknown> = {};
      if (dealDate.date) fields.deal_year = dealDate.date.getUTCFullYear();
      return { dealDate, fields };
    },
  };
}

export const smartNpvConnector = createSmartNpvConnector();
