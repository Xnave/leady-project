/**
 * Reads and writes of `CapabilityInstance` rows — the one place per-tenant
 * behavior is configured. Adding a business type is an insert here; nothing in
 * the flow kernel or the schema changes.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CapabilityInstanceSnapshot } from "@/lib/flow/types";

/** Default instance kind per capability, used when a tenant runs only one. */
export const DEFAULT_INSTANCE_KIND: Record<string, string> = {
  booking: "visit",
  reservations: "stay",
};

function toSnapshot(row: {
  id: string;
  capabilityId: string;
  kind: string;
  enabled: boolean;
  config: Prisma.JsonValue;
}): CapabilityInstanceSnapshot {
  return {
    id: row.id,
    capabilityId: row.capabilityId,
    kind: row.kind,
    enabled: row.enabled,
    config:
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : {},
  };
}

export async function loadCapabilityInstances(
  tenantId: string,
): Promise<CapabilityInstanceSnapshot[]> {
  const rows = await prisma.capabilityInstance.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toSnapshot);
}

/**
 * Config of the tenant's instance for a capability. Returns `{}` when the tenant
 * has not configured one, so callers can lean on their parser's defaults.
 */
export async function loadInstanceConfig(opts: {
  tenantId: string;
  capabilityId: string;
  kind?: string;
}): Promise<Record<string, unknown>> {
  const row = await prisma.capabilityInstance.findFirst({
    where: {
      tenantId: opts.tenantId,
      capabilityId: opts.capabilityId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      enabled: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return row ? toSnapshot(row).config : {};
}

/**
 * Field labels configured across every instance, for operator surfaces that
 * render a request without knowing which vertical produced it.
 */
export async function loadInstanceFieldLabels(
  tenantId: string,
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const instance of await loadCapabilityInstances(tenantId)) {
    const raw = instance.config.fieldLabels;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    for (const [key, label] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof label === "string" && label.trim()) labels[key] = label.trim();
    }
  }
  return labels;
}

/** Create or replace one instance, keyed by its tenant-facing kind. */
export async function upsertCapabilityInstance(opts: {
  tenantId: string;
  capabilityId: string;
  kind?: string;
  enabled?: boolean;
  config: unknown;
}): Promise<CapabilityInstanceSnapshot> {
  const kind = opts.kind ?? DEFAULT_INSTANCE_KIND[opts.capabilityId] ?? opts.capabilityId;
  const config = (opts.config ?? {}) as Prisma.InputJsonValue;
  const row = await prisma.capabilityInstance.upsert({
    where: { tenantId_kind: { tenantId: opts.tenantId, kind } },
    create: {
      tenantId: opts.tenantId,
      capabilityId: opts.capabilityId,
      kind,
      enabled: opts.enabled ?? true,
      config,
    },
    update: {
      capabilityId: opts.capabilityId,
      enabled: opts.enabled ?? true,
      config,
    },
  });
  return toSnapshot(row);
}

/** Inbox tenants get a booking instance so venue hours/templates have a home. */
export async function ensureDefaultBookingInstance(tenantId: string): Promise<void> {
  const existing = await prisma.capabilityInstance.findFirst({
    where: { tenantId, capabilityId: "booking" },
    select: { id: true },
  });
  if (existing) return;
  await upsertCapabilityInstance({
    tenantId,
    capabilityId: "booking",
    config: {},
  });
}

/** Turn an instance off without losing its configuration. */
export async function disableCapabilityInstance(opts: {
  tenantId: string;
  kind: string;
}): Promise<void> {
  await prisma.capabilityInstance.updateMany({
    where: { tenantId: opts.tenantId, kind: opts.kind },
    data: { enabled: false },
  });
}
