import { prisma } from "@/lib/db";

export type NavCounts = {
  inbox: number;
  /** The "needs you" count: leads with a due, un-snoozed follow-up. */
  leads: number;
};

export async function getNavCounts(tenantId: string): Promise<NavCounts> {
  const now = new Date();
  const [inbox, needsYou] = await Promise.all([
    prisma.hitlTask.count({ where: { tenantId, status: "open" } }),
    prisma.lead.count({
      where: {
        tenantId,
        followUpReason: { not: null },
        followUpAt: { lte: now },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
    }),
  ]);
  return { inbox, leads: needsYou };
}
