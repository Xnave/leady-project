import { needsWhere } from "@/lib/crm/needs";
import { prisma } from "@/lib/db";

export type NavCounts = {
  /** The "needs you" count. */
  leads: number;
};

export async function getNavCounts(tenantId: string): Promise<NavCounts> {
  // Demo leads count here on purpose (owner request, 7cc16f2); the CRM list hides
  // them unless "show demo" is on.
  const leads = await prisma.lead.count({ where: { tenantId, ...needsWhere(new Date()) } });
  return { leads };
}
