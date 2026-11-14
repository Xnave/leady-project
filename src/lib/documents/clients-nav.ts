import { prisma } from "@/lib/db";
import { DOCUMENT_TASK_REASONS } from "./review-task";

/** Clients with an open documents task, for the nav badge. Demo people count, like the leads badge. */
export async function countClientsNeedingYou(tenantId: string): Promise<number> {
  const rows = await prisma.hitlTask.findMany({
    where: { tenantId, status: "open", reason: { in: [...DOCUMENT_TASK_REASONS] } },
    distinct: ["leadId"],
    select: { leadId: true },
  });
  return rows.length;
}

/**
 * The Clients tab is the documents screen: it shows when the tenant collects
 * documents (capability on) or already has a file. A CRM synced only for
 * campaigns does not turn it on.
 */
export async function hasClientsScreen(tenantId: string): Promise<boolean> {
  const [instance, dossier] = await Promise.all([
    prisma.capabilityInstance.findFirst({ where: { tenantId, capabilityId: "documents", enabled: true }, select: { id: true } }),
    prisma.dossier.findFirst({ where: { tenantId }, select: { id: true } }),
  ]);
  return Boolean(instance) || Boolean(dossier);
}
