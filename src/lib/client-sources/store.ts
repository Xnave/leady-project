import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getConnector } from "./registry";
import {
  addCounts,
  credentialSecrets,
  emptyCounts,
  runSync,
  safeErrorMessage,
  syncPage,
  type ContactUpsert,
  type SyncCounts,
  type SyncStore,
} from "./sync";
import type { AnyClientConnector, BaseSourceConfig } from "./types";

/**
 * Prisma side of client sources. Every query is scoped by tenantId. Credentials
 * are decrypted only here and only to call the connector; nothing returned from
 * this module carries them.
 */

export type SyncMode = "full" | "incremental";

export type SyncStats = SyncCounts & { duplicatePhone: number; mode: SyncMode; complete: boolean };

/** What screens and API responses may see. No credentials, ever. */
export type PublicClientSource = {
  id: string;
  tenantId: string;
  kind: string;
  kindLabel: { he: string; en: string };
  label: string;
  config: unknown;
  status: string;
  lastError: string;
  lastSyncAt: string | null;
  lastSyncStats: Partial<SyncStats>;
  contactCount: number;
  credentialKeys: string[];
  /** The key comes from another capability (Documents settings), not from this source. */
  sharedCredentials: boolean;
};

type SourceRow = Prisma.ClientSourceGetPayload<object>;

/** True when the connector finds credentials the tenant saved elsewhere. Never returns them. */
export async function hasSharedCredentials(tenantId: string, kind: string): Promise<boolean> {
  const connector = getConnector(kind);
  if (!connector?.sharedCredentials) return false;
  try {
    return Boolean(await connector.sharedCredentials(tenantId));
  } catch {
    return false;
  }
}

function publicSource(row: SourceRow, contactCount: number, sharedCredentials: boolean): PublicClientSource {
  const connector = getConnector(row.kind);
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    kindLabel: connector?.label ?? { he: row.kind, en: row.kind },
    label: row.label,
    config: row.config,
    status: row.status,
    lastError: row.lastError,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastSyncStats: (row.lastSyncStats ?? {}) as Partial<SyncStats>,
    contactCount,
    credentialKeys: connector?.credentialFields.map((f) => f.key) ?? [],
    sharedCredentials,
  };
}

export async function listClientSources(tenantId: string): Promise<PublicClientSource[]> {
  const rows = await prisma.clientSource.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  if (!rows.length) return [];
  const counts = await prisma.contact.groupBy({
    by: ["sourceId"],
    where: { tenantId, sourceId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const bySource = new Map(counts.map((c) => [c.sourceId, c._count._all]));
  const shared = await Promise.all(rows.map((r) => hasSharedCredentials(tenantId, r.kind)));
  return rows.map((r, i) => publicSource(r, bySource.get(r.id) ?? 0, shared[i]));
}

export async function hasClientSources(tenantId: string): Promise<boolean> {
  return (await prisma.clientSource.count({ where: { tenantId } })) > 0;
}

export type SaveSourceInput = {
  kind: string;
  label?: string;
  /** Omit to keep the stored credentials (config-only edit). */
  credentials?: Record<string, unknown>;
  config?: unknown;
};

export type SaveSourceError = "unknown_kind" | "bad_credentials" | "bad_config" | "credentials_required";

function configError(err: unknown): string {
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; ");
  return err instanceof Error ? err.message : "bad_config";
}

/** Create or replace the tenant's source of this kind. Validates credentials and config with the connector. */
export async function saveClientSource(
  tenantId: string,
  input: SaveSourceInput,
): Promise<{ source: PublicClientSource } | { error: SaveSourceError; detail?: string }> {
  const connector = getConnector(input.kind);
  if (!connector) return { error: "unknown_kind" };

  let config: BaseSourceConfig;
  try {
    config = connector.parseConfig(input.config ?? {});
  } catch (err) {
    return { error: "bad_config", detail: configError(err) };
  }

  let credentialsEnc: string | undefined;
  if (input.credentials) {
    const parsed = connector.credentialsSchema.safeParse(input.credentials);
    if (!parsed.success) return { error: "bad_credentials", detail: parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
    credentialsEnc = encryptSecret(JSON.stringify(parsed.data));
  }

  const existing = await prisma.clientSource.findUnique({ where: { tenantId_kind: { tenantId, kind: input.kind } } });
  if (!existing && credentialsEnc === undefined) return { error: "credentials_required" };

  const data = {
    label: (input.label ?? existing?.label ?? "").trim().slice(0, 80),
    config: config as unknown as Prisma.InputJsonValue,
    ...(credentialsEnc !== undefined ? { credentialsEnc, status: "idle", lastError: "" } : {}),
  };
  const row = existing
    ? await prisma.clientSource.update({ where: { id: existing.id }, data })
    : await prisma.clientSource.create({
        data: { tenantId, kind: input.kind, credentialsEnc: credentialsEnc!, syncSince: new Date(), ...data },
      });
  const count = await prisma.contact.count({ where: { tenantId, sourceId: row.id } });
  return { source: publicSource(row, count, false) };
}

type LoadedSource = {
  row: SourceRow;
  connector: AnyClientConnector;
  credentials: unknown;
  config: BaseSourceConfig;
};

async function loadForSync(tenantId: string, sourceId: string): Promise<LoadedSource> {
  const row = await prisma.clientSource.findFirst({ where: { id: sourceId, tenantId } });
  if (!row) throw new Error("source_not_found");
  const connector = getConnector(row.kind);
  if (!connector) throw new Error(`unknown_kind:${row.kind}`);
  if (!row.credentialsEnc) throw new Error("credentials_required");
  const credentials = JSON.parse(decryptSecret(row.credentialsEnc)) as unknown;
  const config = connector.parseConfig(row.config);
  return { row, connector, credentials, config };
}

const phoneVariants = (phone: string) => [phone, `+${phone}`];

export function prismaSyncStore(tenantId: string, sourceId: string): SyncStore {
  return {
    async leadIdsByPhone(phones) {
      const leads = await prisma.lead.findMany({
        where: { tenantId, externalUserId: { in: phones.flatMap(phoneVariants) } },
        select: { id: true, externalUserId: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      });
      const out = new Map<string, string>();
      for (const lead of leads) {
        const key = lead.externalUserId.replace(/\D/g, "");
        if (!out.has(key)) out.set(key, lead.id);
      }
      return out;
    },

    async existingExternalIds(externalIds) {
      if (!externalIds.length) return new Set<string>();
      const rows = await prisma.contact.findMany({
        where: { tenantId, sourceId, externalId: { in: externalIds } },
        select: { externalId: true },
      });
      return new Set(rows.map((r) => r.externalId));
    },

    async upsertContacts(rows: ContactUpsert[]) {
      const existing = await prisma.contact.findMany({
        where: { tenantId, sourceId, externalId: { in: rows.map((r) => r.externalId) } },
        select: { externalId: true, phone: true },
      });
      const known = new Set(existing.map((e) => e.externalId));
      const phoneBefore = new Map(existing.map((e) => [e.externalId, e.phone]));
      const syncedAt = new Date();
      await prisma.$transaction(
        rows.map((r) => {
          const values = {
            phone: r.phone,
            phoneStatus: r.phoneStatus,
            name: r.name,
            raw: r.raw as Prisma.InputJsonValue,
            mapped: r.mapped as Prisma.InputJsonValue,
            dealDate: r.dealDate.date,
            dealDateSource: r.dealDate.source,
            dealDateConfidence: r.dealDate.confidence,
            sourceUpdatedAt: r.sourceUpdatedAt,
            skipped: r.skipped,
            syncedAt,
          };
          // Same phone: keep the link unless this page found one. New phone: the link follows it, even to none.
          const phoneChanged = phoneBefore.has(r.externalId) && phoneBefore.get(r.externalId) !== r.phone;
          return prisma.contact.upsert({
            where: { tenantId_sourceId_externalId: { tenantId, sourceId, externalId: r.externalId } },
            create: { tenantId, sourceId, externalId: r.externalId, leadId: r.leadId, ...values },
            update: { ...values, ...(phoneChanged || r.leadId ? { leadId: r.leadId } : {}) },
          });
        }),
      );
      const created = rows.filter((r) => !known.has(r.externalId)).length;
      return { created, updated: rows.length - created };
    },
  };
}

/** Contacts in this source sharing a phone with another contact (counted once per extra row). */
async function duplicatePhones(tenantId: string, sourceId: string): Promise<number> {
  const groups = await prisma.contact.groupBy({
    by: ["phone"],
    where: { tenantId, sourceId, phone: { not: "" } },
    _count: { _all: true },
    having: { phone: { _count: { gt: 1 } } },
  });
  return groups.reduce((sum, g) => sum + g._count._all - 1, 0);
}

/** Mark a sync as running and pick its starting point. */
export async function beginSourceSync(
  tenantId: string,
  sourceId: string,
  mode: SyncMode,
): Promise<{ updatedSince: string | null }> {
  const row = await prisma.clientSource.findFirst({
    where: { id: sourceId, tenantId },
    select: { lastSyncAt: true, status: true, syncSince: true },
  });
  if (!row) throw new Error("source_not_found");
  const syncSince = row.syncSince ?? new Date();
  await prisma.clientSource.update({
    where: { id: sourceId },
    data: { status: "syncing", lastError: "", ...(row.syncSince ? {} : { syncSince }) },
  });
  const since = mode === "incremental" && row.lastSyncAt && row.status !== "error" ? row.lastSyncAt : null;
  return { updatedSince: since?.toISOString() ?? null };
}

/** One page of a running sync. Errors are recorded on the source (masked) and rethrown. */
export async function syncSourcePage(
  tenantId: string,
  sourceId: string,
  cursor: string | null,
  updatedSince: string | null,
): Promise<{ counts: SyncCounts; nextCursor: string | null }> {
  const loaded = await loadForSync(tenantId, sourceId);
  try {
    const page = await syncPage({
      key: sourceId,
      connector: loaded.connector,
      credentials: loaded.credentials,
      config: loaded.config,
      store: prismaSyncStore(tenantId, sourceId),
      cursor,
      updatedSince: updatedSince ? new Date(updatedSince) : null,
      syncSince: loaded.row.syncSince,
      now: new Date(),
    });
    return { counts: page.counts, nextCursor: page.nextCursor };
  } catch (err) {
    await failSourceSync(tenantId, sourceId, safeErrorMessage(err, credentialSecrets(loaded.credentials)));
    throw new Error(safeErrorMessage(err, credentialSecrets(loaded.credentials)));
  }
}

export async function failSourceSync(tenantId: string, sourceId: string, message: string): Promise<void> {
  await prisma.clientSource.updateMany({ where: { id: sourceId, tenantId }, data: { status: "error", lastError: message } });
}

export async function finishSourceSync(
  tenantId: string,
  sourceId: string,
  counts: SyncCounts,
  mode: SyncMode,
  complete: boolean,
): Promise<SyncStats> {
  const stats: SyncStats = { ...counts, duplicatePhone: await duplicatePhones(tenantId, sourceId), mode, complete };
  await prisma.clientSource.updateMany({
    where: { id: sourceId, tenantId },
    data: {
      status: complete ? "ok" : "error",
      lastError: complete ? "" : "stopped before the last page",
      lastSyncAt: new Date(),
      lastSyncStats: stats as unknown as Prisma.InputJsonValue,
    },
  });
  console.log(JSON.stringify({ msg: "client_sources.sync", tenantId, sourceId, ...stats }));
  return stats;
}

/** The whole sync in this process: local dev without Inngest, and tests against a real DB. */
export async function runSourceSyncInline(tenantId: string, sourceId: string, mode: SyncMode): Promise<SyncStats> {
  const { updatedSince } = await beginSourceSync(tenantId, sourceId, mode);
  let counts = emptyCounts();
  let cursor: string | null = null;
  const MAX_PAGES = 2_000;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await syncSourcePage(tenantId, sourceId, cursor, updatedSince);
    counts = addCounts(counts, page.counts);
    cursor = page.nextCursor;
    if (!cursor) return finishSourceSync(tenantId, sourceId, counts, mode, true);
  }
  return finishSourceSync(tenantId, sourceId, counts, mode, false);
}

export type TestResult =
  | { ok: true; counts: SyncCounts; fieldKeys: string[]; morePages: boolean }
  | { ok: false; error: string };

/** Connection check: the first page only, nothing written. Field names and counts only, no client data. */
export async function testClientSource(tenantId: string, sourceId: string): Promise<TestResult> {
  let loaded: LoadedSource;
  try {
    loaded = await loadForSync(tenantId, sourceId);
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err, []) };
  }
  try {
    const result = await runSync({
      key: `test:${sourceId}`,
      connector: loaded.connector,
      credentials: loaded.credentials,
      config: loaded.config,
      store: prismaSyncStore(tenantId, sourceId),
      updatedSince: null,
      syncSince: loaded.row.syncSince,
      now: new Date(),
      dryRun: true,
      maxPages: 1,
    });
    return { ok: true, counts: result.counts, fieldKeys: result.fieldKeys, morePages: !result.complete };
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err, credentialSecrets(loaded.credentials)) };
  }
}
