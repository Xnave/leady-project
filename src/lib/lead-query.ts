import type { Prisma } from "@prisma/client";
import { LEAD_STATUSES, type LeadStatusId } from "@/lib/ui";

export type LeadKind = "all" | "live" | "demo";

export type LeadFilters = {
  q: string;
  kind: LeadKind;
  status: LeadStatusId | "all";
};

export function parseLeadFilters(sp: {
  q?: string;
  kind?: string;
  status?: string;
}): LeadFilters {
  const status = sp.status;
  return {
    q: sp.q?.trim() ?? "",
    kind: sp.kind === "demo" || sp.kind === "live" ? sp.kind : "all",
    status: LEAD_STATUSES.includes(status as LeadStatusId)
      ? (status as LeadStatusId)
      : "all",
  };
}

/**
 * Shared by the leads table and the CSV export so an owner exports exactly the
 * rows they are looking at. Search covers the captured contact fields too — an
 * owner searching a phone number does not care that it lives in `fields` JSON.
 */
export function leadWhere(tenantId: string, f: LeadFilters): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { tenantId };
  if (f.q) {
    where.OR = [
      { displayName: { contains: f.q, mode: "insensitive" } },
      { externalUserId: { contains: f.q, mode: "insensitive" } },
      { fields: { path: ["phone"], string_contains: f.q } },
      { fields: { path: ["email"], string_contains: f.q } },
      { fields: { path: ["name"], string_contains: f.q } },
    ];
  }
  if (f.kind === "demo") where.externalUserId = { startsWith: "demo-" };
  if (f.kind === "live") where.NOT = { externalUserId: { startsWith: "demo-" } };
  if (f.status !== "all") {
    // Legacy rows stored "closed"; the UI folds that into "lost".
    where.status = f.status === "lost" ? { in: ["lost", "closed"] } : f.status;
  }
  return where;
}

export function leadFilterParams(f: LeadFilters): Record<string, string> {
  return {
    ...(f.q ? { q: f.q } : {}),
    ...(f.kind !== "all" ? { kind: f.kind } : {}),
    ...(f.status !== "all" ? { status: f.status } : {}),
  };
}
