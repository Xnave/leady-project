/** The "Won" stage label for a tenant: its one enabled capability's own word, else the generic "Won". */
import { prisma } from "@/lib/db";
import type { UiCopy } from "@/lib/ui";

export async function loadWonLabel(tenantId: string, ui: UiCopy): Promise<string> {
  const instances = await prisma.capabilityInstance.findMany({
    where: { tenantId, enabled: true },
    select: { capabilityId: true },
  });
  const caps = [...new Set(instances.map((i) => i.capabilityId))];
  return (caps.length === 1 && ui.crm.wonByCapability[caps[0]]) || ui.crm.stages.won;
}
