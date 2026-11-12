import { z } from "zod";
import { baseConfigSchema, dealDateStepSchema } from "./config";
import { deriveDealDate, type DealDateStep } from "./dates";
import {
  ConnectorAuthError,
  SessionExpiredError,
  type BaseSourceConfig,
  type ClientConnector,
  type ClientFieldDef,
  type ClientRecord,
} from "./types";

/**
 * In-memory connector for tests and local demos. Pages a fixed client list,
 * can expire its session once, and rejects the password "wrong".
 */

const credentialsSchema = z.object({ token: z.string().min(1) });
type FakeCredentials = z.infer<typeof credentialsSchema>;

const FAKE_DEAL_DATE: DealDateStep[] = [
  { field: "signed_at", offsetMonths: 0, confidence: "high" },
  { field: "opened_at", offsetMonths: 3, confidence: "low" },
];

const configSchema = baseConfigSchema.extend({
  pageSize: z.number().int().min(1).default(2),
  dealDate: z.array(dealDateStepSchema).min(1).default(FAKE_DEAL_DATE),
});
type FakeConfig = z.infer<typeof configSchema> & BaseSourceConfig;

type FakeSession = { id: number };

export const FAKE_FIELDS: ClientFieldDef[] = [
  { key: "signed_at", label: { he: "נחתם", en: "Signed" }, type: "date", agentVisible: false, listColumn: true },
  { key: "opened_at", label: { he: "נפתח", en: "Opened" }, type: "date", agentVisible: false },
  { key: "archived", label: { he: "בארכיון", en: "Archived" }, type: "flag", agentVisible: false, listColumn: true },
];

export const FAKE_CLIENTS: ClientRecord[] = [
  { externalId: "c1", phone: "050-1234567", name: "Dana Levi", fields: { signed_at: "10/03/2019" }, updatedAt: null },
  { externalId: "c2", phone: "+972 52 765 4321", name: "Avi Cohen", fields: { opened_at: "2017-01-15" }, updatedAt: null },
  { externalId: "c3", phone: "", name: "No Phone", fields: {}, updatedAt: null },
  { externalId: "c4", phone: "123", name: "Bad Phone", fields: { archived: "1" }, updatedAt: null },
  { externalId: "c5", phone: "0501234567", name: "Dana Again", fields: {}, updatedAt: null },
];

export function createFakeConnector(
  opts: { clients?: ClientRecord[]; expireOnceAtCursor?: string; rejectOnceAtCursor?: string; onAuthenticate?: () => void } = {},
): ClientConnector<FakeCredentials, FakeSession, FakeConfig> {
  const clients = opts.clients ?? FAKE_CLIENTS;
  let sessions = 0;
  let expired = false;
  let rejected = false;
  return {
    kind: "fake",
    label: { he: "בדיקה (מקומי)", en: "Fake (local)" },
    credentialsSchema,
    credentialFields: [{ key: "token", label: { he: "טוקן", en: "Token" }, secret: true }],
    parseConfig: (raw) => configSchema.parse(raw ?? {}) as FakeConfig,
    sessionTtlSeconds: 60,
    fieldCatalog: FAKE_FIELDS,
    archivedField: "archived",
    async authenticate(credentials) {
      opts.onAuthenticate?.();
      if (credentials.token === "wrong") throw new ConnectorAuthError();
      sessions += 1;
      return { id: sessions };
    },
    async fetchClients(session, config, { cursor }) {
      if (opts.expireOnceAtCursor != null && cursor === opts.expireOnceAtCursor && !expired && session.id === 1) {
        expired = true;
        throw new SessionExpiredError();
      }
      if (opts.rejectOnceAtCursor != null && cursor === opts.rejectOnceAtCursor && !rejected) {
        rejected = true;
        throw new ConnectorAuthError("rejected_key");
      }
      const start = cursor ? Number(cursor) : 0;
      const page = clients.slice(start, start + config.pageSize);
      const next = start + config.pageSize;
      return { clients: page, nextCursor: next < clients.length ? String(next) : null };
    },
    derive(record, config) {
      return { dealDate: deriveDealDate(record.fields, config.dealDate), fields: {} };
    },
  };
}
