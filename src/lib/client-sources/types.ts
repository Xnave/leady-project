import type { z } from "zod";

/**
 * A connector speaks to one kind of tenant CRM (Smart NPV, a CSV upload, ...).
 * The sync worker, storage and screens are generic; everything CRM-specific
 * lives behind this interface, one file per kind, registered in `registry.ts`.
 */

export type Localized = { he: string; en: string };

export type ClientFieldType = "text" | "date" | "number" | "flag";

export type ClientFieldDef = {
  key: string;
  label: Localized;
  type: ClientFieldType;
  /** The agent may see this field in a campaign reply by default. */
  agentVisible: boolean;
  /** Shown as a column in the Clients tab. */
  listColumn?: boolean;
  /** Computed by the connector from raw fields, not read from the CRM. */
  derived?: boolean;
};

export type CredentialFieldDef = {
  key: string;
  label: Localized;
  /** Rendered as a password input and never echoed back. */
  secret: boolean;
};

/** One client as a connector returns it, before phone normalization. */
export type ClientRecord = {
  externalId: string;
  phone: string;
  name: string;
  /** Only catalog fields. Connectors drop everything else (ids, income, birthdays). */
  fields: Record<string, unknown>;
  updatedAt: Date | null;
};

export type ClientPage = { clients: ClientRecord[]; nextCursor: string | null };

export type FetchClientsOptions = {
  cursor: string | null;
  /** Incremental sync: only clients changed since then. Null = everything. */
  updatedSince: Date | null;
};

export type DealDateConfidence = "high" | "medium_high" | "medium" | "low";

export type DealDate = {
  date: Date | null;
  /** Field the date came from, "" when nothing matched. */
  source: string;
  confidence: DealDateConfidence | "";
};

/** Settings every connector shares; each connector adds its own on top. */
export type BaseSourceConfig = {
  /** Country code for local numbers ("05..." becomes "9725..."). */
  defaultCountryCode: string;
  /** Skip a client when `fields[field]` is one of `in` (e.g. archived files). */
  skip: { field: string; in: string[] }[];
  /**
   * Store only relevant clients (e.g. a campaign's deal-date window and statuses).
   * New clients that fail it are not stored; stored ones are never removed.
   */
  keep: {
    dealYearsAgo?: { min?: number; max?: number };
    fields: { field: string; in: string[] }[];
  };
};

export type ClientConnector<Credentials = unknown, Session = unknown, Config extends BaseSourceConfig = BaseSourceConfig> = {
  kind: string;
  label: Localized;
  credentialsSchema: z.ZodType<Credentials>;
  credentialFields: CredentialFieldDef[];
  /**
   * Credentials the tenant already saved elsewhere (e.g. the Smart NPV key on the
   * documents capability). When this returns a value it wins over the source's
   * own credentials, so one key lives in one place.
   */
  sharedCredentials?(tenantId: string): Promise<Credentials | null>;
  /** Fills defaults; throws ZodError on a bad tenant config. */
  parseConfig(raw: unknown): Config;
  /** CRM-specific login. Throw ConnectorAuthError on bad credentials. */
  authenticate(credentials: Credentials, config: Config): Promise<Session>;
  /** Throw SessionExpiredError and the sync re-authenticates once and retries. */
  fetchClients(session: Session, config: Config, opts: FetchClientsOptions): Promise<ClientPage>;
  fieldCatalog: ClientFieldDef[];
  /** Derived values computed from a client's raw fields. */
  derive(record: ClientRecord, config: Config, now: Date): { dealDate: DealDate; fields: Record<string, unknown> };
  /** Seconds a session stays valid; null = until the CRM says otherwise. */
  sessionTtlSeconds: number | null;
};

export type AnyClientConnector = ClientConnector<any, any, any>;

export class ConnectorAuthError extends Error {
  constructor(message = "auth_failed") {
    super(message);
    this.name = "ConnectorAuthError";
  }
}

export class SessionExpiredError extends Error {
  constructor(message = "session_expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}
