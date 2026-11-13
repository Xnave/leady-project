import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Clients tab filters, read from the URL. Anything unrecognized falls back to "no filter". */
export type ClientListFilters = {
  q: string;
  /** "" = any, "none" = no deal date, otherwise a confidence level. */
  confidence: "" | "none" | "high" | "medium_high" | "medium" | "low";
  dealFrom: number | null;
  dealTo: number | null;
  page: number;
};

export const CLIENTS_PAGE_SIZE = 50;

const CONFIDENCES = new Set(["none", "high", "medium_high", "medium", "low"]);

function year(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1970 && n <= 2100 ? n : null;
}

export function parseClientFilters(params: Record<string, string | string[] | undefined>): ClientListFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const confidence = one("confidence");
  const page = Number(one("page"));
  return {
    q: one("q").slice(0, 80),
    confidence: (CONFIDENCES.has(confidence) ? confidence : "") as ClientListFilters["confidence"],
    dealFrom: year(one("from")),
    dealTo: year(one("to")),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function clientWhere(tenantId: string, f: ClientListFilters): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [{ tenantId }];
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    const or: Prisma.ContactWhereInput[] = [{ name: { contains: f.q, mode: "insensitive" } }];
    // "050-123" → "50123" matches inside "97250123..."
    if (digits.length >= 3) or.push({ phone: { contains: digits.replace(/^0/, "") } });
    and.push({ OR: or });
  }
  if (f.confidence === "none") and.push({ dealDate: null });
  else if (f.confidence) and.push({ dealDateConfidence: f.confidence });
  if (f.dealFrom != null) and.push({ dealDate: { gte: new Date(Date.UTC(f.dealFrom, 0, 1)) } });
  if (f.dealTo != null) and.push({ dealDate: { lt: new Date(Date.UTC(f.dealTo + 1, 0, 1)) } });
  return { AND: and };
}

export async function listClients(tenantId: string, f: ClientListFilters) {
  const where = clientWhere(tenantId, f);
  const [total, rows] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      orderBy: [{ dealDate: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      skip: (f.page - 1) * CLIENTS_PAGE_SIZE,
      take: CLIENTS_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        phone: true,
        phoneStatus: true,
        dealDate: true,
        dealDateSource: true,
        dealDateConfidence: true,
        leadId: true,
        source: { select: { kind: true } },
      },
    }),
  ]);
  return { total, rows };
}
