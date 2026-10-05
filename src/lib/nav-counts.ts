import { cache } from "react";
import { needsWhere } from "@/lib/crm/needs";
import { prisma } from "@/lib/db";
import { logCrmPerf } from "@/lib/perf";

export type NavCounts = {
  /** The "needs you" count. */
  leads: number;
};

export const getNavCounts = cache(async (tenantId: string): Promise<NavCounts> => {
  const started = Date.now();
  // Demo leads count here on purpose (owner request, 7cc16f2); the CRM list hides
  // them unless "show demo" is on.
  const leads = await prisma.lead.count({ where: { tenantId, ...needsWhere(new Date()) } });
  logCrmPerf("crm.nav_counts", { tenantId, leads, ms: Date.now() - started });
  return { leads };
});
