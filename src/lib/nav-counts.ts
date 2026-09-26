import { crmV2Enabled } from "@/lib/crm/flags";
import { needsWhere } from "@/lib/crm/needs";
import { prisma } from "@/lib/db";

export type NavCounts = {
  inbox: number;
  /** CRM v2 on: the "needs you" count. Off: the legacy unread-leads count. */
  leads: number;
  /** Whether `leads` is the "needs you" count (CRM v2) or the legacy unread count. */
  crmV2: boolean;
};

export async function getNavCounts(tenantId: string): Promise<NavCounts> {
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId }, select: { crmV2: true } });
  const crmV2 = crmV2Enabled({ crmV2: tenant?.crmV2 ?? false });
  const [inbox, leads] = await Promise.all([
    prisma.hitlTask.count({ where: { tenantId, status: "open" } }),
    // Demo leads count here on purpose in both modes (owner request, 7cc16f2);
    // the CRM list hides them unless "show demo" is on.
    crmV2
      ? prisma.lead.count({ where: { tenantId, ...needsWhere(new Date()) } })
      : prisma.lead.count({ where: { tenantId, adminUnread: true } }),
  ]);
  return { inbox, leads, crmV2 };
}
