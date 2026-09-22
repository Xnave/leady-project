import { prisma } from "@/lib/db";

export type NavCounts = {
  inbox: number;
  leads: number;
};

export async function getNavCounts(tenantId: string): Promise<NavCounts> {
  const [inbox, unreadLeads] = await Promise.all([
    prisma.hitlTask.count({ where: { tenantId, status: "open" } }),
    prisma.lead.count({
      where: {
        tenantId,
        adminUnread: true,
      },
    }),
  ]);
  return { inbox, leads: unreadLeads };
}
