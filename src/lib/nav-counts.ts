import { cache } from "react";
import { needsWhere } from "@/lib/crm/needs";
import { countClientsNeedingYou } from "@/lib/documents/clients-nav";
import { prisma } from "@/lib/db";
import { logCrmPerf } from "@/lib/perf";

export type NavCounts = {
  /** The "needs you" count. */
  leads: number;
  /** Clients whose document file waits on the team (open documents task). */
  clients: number;
};

export const getNavCounts = cache(async (tenantId: string): Promise<NavCounts> => {
  const started = Date.now();
  // Demo leads count here on purpose (owner request, 7cc16f2); the CRM list hides
  // them unless "show demo" is on.
  const [leads, clients] = await Promise.all([
    prisma.lead.count({ where: { tenantId, ...needsWhere(new Date()) } }),
    countClientsNeedingYou(tenantId),
  ]);
  logCrmPerf("crm.nav_counts", { tenantId, leads, clients, ms: Date.now() - started });
  return { leads, clients };
});
