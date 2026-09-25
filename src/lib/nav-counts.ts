import { needsWhere } from "@/lib/crm/needs";
import { prisma } from "@/lib/db";

export type NavCounts = {
  inbox: number;
  /** The "needs you" count: leads with a due, un-snoozed follow-up. */
  leads: number;
};

export async function getNavCounts(tenantId: string): Promise<NavCounts> {
  const [inbox, needsYou] = await Promise.all([
    prisma.hitlTask.count({ where: { tenantId, status: "open" } }),
    // Demo leads count here on purpose (owner request, 7cc16f2); the CRM list hides them unless "show demo" is on.
    prisma.lead.count({ where: { tenantId, ...needsWhere(new Date()) } }),
  ]);
  return { inbox, leads: needsYou };
}
