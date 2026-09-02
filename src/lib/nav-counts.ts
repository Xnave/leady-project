import { prisma } from "@/lib/db";

export type NavCounts = {
  inbox: number;
  leads: number;
};

export async function getNavCounts(tenantId: string): Promise<NavCounts> {
  const [inbox, leadsWithPending, newLeads] = await Promise.all([
    prisma.hitlTask.count({ where: { tenantId, status: "open" } }),
    prisma.lead.count({
      where: { tenantId, meetings: { some: { status: "pending" } } },
    }),
    prisma.lead.count({
      where: { tenantId, status: { in: ["new", "open", "in_progress"] } },
    }),
  ]);
  return { inbox, leads: leadsWithPending + newLeads };
}
