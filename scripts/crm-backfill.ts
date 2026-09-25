/**
 * One-off: map legacy Lead.status to manual stages, then derive every lead.
 * Safe to re-run — refreshLeadState writes only what changed.
 *   npm run crm:backfill
 */
import { prisma } from "../src/lib/db";
import { refreshLeadState } from "../src/lib/crm/refresh";

async function main() {
  const legacy = await prisma.lead.findMany({
    where: { status: { in: ["won", "lost", "closed"] }, stageSource: "auto" },
    select: { id: true, status: true },
  });
  for (const l of legacy) {
    await prisma.lead.update({
      where: { id: l.id },
      data: {
        stage: l.status === "won" ? "won" : "lost",
        stageSource: "manual",
        stageReason: "migrated",
        stageChangedAt: new Date(),
      },
    });
  }
  const all = await prisma.lead.findMany({ select: { id: true, tenantId: true } });
  let changed = 0;
  for (const l of all) {
    const plan = await refreshLeadState(l.tenantId, l.id);
    if (plan && Object.keys(plan.patch).length) changed++;
  }
  console.log(`crm backfill: ${legacy.length} legacy statuses mapped, ${changed}/${all.length} leads updated`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
