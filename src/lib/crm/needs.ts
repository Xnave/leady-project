import type { Prisma } from "@prisma/client";

/** The single "needs you" predicate: a follow-up is due and the lead is not snoozed. */
export function needsWhere(now: Date): Prisma.LeadWhereInput {
  return {
    followUpReason: { not: null },
    followUpAt: { lte: now },
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
  };
}
