import { prisma } from "@/lib/db";

/**
 * Open HITL tasks on a lead that a turn opened, plus the message that
 * triggered it. Tasks are matched from the trigger message's time, not the
 * worker's start, so a retried turn still finds what its first attempt
 * created; callers dedupe by task id.
 */
export async function tasksOpenedThisTurn(o: {
  tenantId: string;
  leadId: string;
  triggerMessageId?: string;
  since: Date;
}) {
  const trigger = o.triggerMessageId
    ? await prisma.message.findFirst({
        where: { id: o.triggerMessageId, tenantId: o.tenantId },
        select: { createdAt: true, providerMessageId: true },
      })
    : null;
  const tasks = await prisma.hitlTask.findMany({
    where: {
      tenantId: o.tenantId,
      leadId: o.leadId,
      status: "open",
      createdAt: { gte: trigger?.createdAt ?? o.since },
    },
    orderBy: { createdAt: "asc" },
  });
  return { trigger, tasks };
}
