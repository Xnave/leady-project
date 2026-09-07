import type { Prisma } from "@prisma/client";
import { LEAD_STATUSES, type LeadStatusId } from "@/lib/ui";

export type LeadKind = "all" | "live" | "demo";
export type LeadRange = "today" | "7d" | "30d" | "all";

export const LEAD_RANGES: LeadRange[] = ["today", "7d", "30d", "all"];

export type LeadFilters = {
  q: string;
  kind: LeadKind;
  status: LeadStatusId | "all";
  range: LeadRange;
};

/** Start of the window, in the server's local day, or null for "all". */
export function rangeStart(range: LeadRange, now: Date = new Date()): Date | null {
  if (range === "all") return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return start;
}

export function parseLeadFilters(sp: {
  q?: string;
  kind?: string;
  status?: string;
  range?: string;
}): LeadFilters {
  const status = sp.status;
  const range = sp.range;
  return {
    q: sp.q?.trim() ?? "",
    kind: sp.kind === "demo" || sp.kind === "live" ? sp.kind : "all",
    status: LEAD_STATUSES.includes(status as LeadStatusId)
      ? (status as LeadStatusId)
      : "all",
    range: LEAD_RANGES.includes(range as LeadRange) ? (range as LeadRange) : "all",
  };
}

/**
 * Shared by the conversation list and the CSV export so an owner exports exactly
 * the rows they are looking at. Search covers the captured contact fields too —
 * an owner searching a phone number does not care that it lives in `fields` JSON.
 * Clauses go in `AND` so search and date range compose instead of overwriting
 * each other's `OR`.
 */
export function leadWhere(
  tenantId: string,
  f: LeadFilters,
  now: Date = new Date(),
): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [];

  if (f.q) {
    and.push({
      OR: [
        { displayName: { contains: f.q, mode: "insensitive" } },
        { externalUserId: { contains: f.q, mode: "insensitive" } },
        { fields: { path: ["phone"], string_contains: f.q } },
        { fields: { path: ["email"], string_contains: f.q } },
        { fields: { path: ["name"], string_contains: f.q } },
      ],
    });
  }
  if (f.kind === "demo") and.push({ externalUserId: { startsWith: "demo-" } });
  if (f.kind === "live") and.push({ NOT: { externalUserId: { startsWith: "demo-" } } });
  if (f.status !== "all") {
    // Legacy rows stored "closed"; the UI folds that into "lost".
    and.push({ status: f.status === "lost" ? { in: ["lost", "closed"] } : f.status });
  }
  const start = rangeStart(f.range, now);
  // `updatedAt` is the lead's last activity — every inbound message and every
  // owner reply touches the row, so the date filter and the day headings agree.
  if (start) and.push({ updatedAt: { gte: start } });

  return and.length > 0 ? { tenantId, AND: and } : { tenantId };
}

export function leadFilterParams(f: LeadFilters): Record<string, string> {
  return {
    ...(f.q ? { q: f.q } : {}),
    ...(f.kind !== "all" ? { kind: f.kind } : {}),
    ...(f.status !== "all" ? { status: f.status } : {}),
    ...(f.range !== "all" ? { range: f.range } : {}),
  };
}
