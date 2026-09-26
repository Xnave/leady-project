/**
 * One-off: map legacy Lead.status (won / lost / closed) to a manual stage,
 * then derive every lead. Run it BEFORE enabling crmV2 / CRM_V2_ALL.
 *   npm run crm:backfill
 *
 * Re-running is safe:
 * - The legacy mapping touches only leads that are still `auto` and have no
 *   MANUAL LeadStageEvent (an owner action, or a prior migration — migrated
 *   events are `source: "manual"`). Auto events written by ordinary chat
 *   traffic before the backfill do not block the mapping.
 * - The refresh pass writes only what changed (refreshLeadState).
 * Not safe to assume: a lead whose legacy status changed after a previous run
 * but that already has a manual stage event keeps its current stage.
 */
import { prisma } from "../src/lib/db";
import { refreshLeadState } from "../src/lib/crm/refresh";

async function main() {
  const legacy = await prisma.lead.findMany({
    where: {
      status: { in: ["won", "lost", "closed"] },
      stageSource: "auto",
      stageEvents: { none: { source: "manual" } },
    },
    select: { id: true, tenantId: true, status: true, updatedAt: true },
  });
  for (const l of legacy) {
    const to = l.status === "won" ? "won" : "lost";
    // Keep the legacy decision's time so "won in the last 30 days" is not inflated.
    const at = l.updatedAt;
    await prisma.$transaction([
      prisma.lead.update({
        where: { id: l.id },
        data: { stage: to, stageSource: "manual", stageReason: "migrated", stageChangedAt: at },
      }),
      prisma.leadStageEvent.create({
        data: {
          tenantId: l.tenantId,
          leadId: l.id,
          from: "new",
          to,
          source: "manual",
          reason: "migrated",
          createdAt: at,
        },
      }),
    ]);
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
