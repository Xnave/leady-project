import { Prisma } from "@prisma/client";
import { REQUEST_APPROVAL_TASK } from "@/lib/requests";
import { FOLLOW_UP_PRIORITY, type FollowUpReason } from "./types";

/** A task the owner must act on: still open, on a conversation that is not closed. */
const OPEN_TASK: Prisma.HitlTaskWhereInput = { status: "open", conversation: { status: { not: "closed" } } };

/**
 * An approval task whose request was rescheduled waits on the customer, not the owner.
 * Tasks created before the flag existed have no key at all; a JSON path lookup on a
 * missing key is SQL NULL, which `DbNull` matches and `NOT equals true` would drop.
 */
const NOT_AWAITING_CUSTOMER: Prisma.HitlTaskWhereInput[] = [
  { payload: { path: ["awaitingCustomerConfirm"], equals: false } },
  { payload: { path: ["awaitingCustomerConfirm"], equals: Prisma.DbNull } },
];

/** Tasks the owner must act on for a lead, read from HITL tasks (the source of truth). */
export const OPEN_HANDOFF_TASK: Prisma.HitlTaskWhereInput = { ...OPEN_TASK, type: { not: REQUEST_APPROVAL_TASK } };
export const OPEN_APPROVAL_TASK: Prisma.HitlTaskWhereInput = {
  ...OPEN_TASK,
  type: REQUEST_APPROVAL_TASK,
  OR: NOT_AWAITING_CUSTOMER,
};

/**
 * Leads that need the owner for one reason. Handoffs and approvals come straight from
 * open tasks; reminders and cold leads are time-based, so they come from the stored
 * attention columns (due, and not snoozed).
 */
export function reasonWhere(reason: FollowUpReason, now: Date): Prisma.LeadWhereInput {
  switch (reason) {
    case "handoff":
      return { hitlTasks: { some: OPEN_HANDOFF_TASK } };
    case "approval":
      return { hitlTasks: { some: OPEN_APPROVAL_TASK } };
    case "reminder":
    case "cold":
      return {
        attentionReason: reason,
        attentionAt: { lte: now },
        AND: [{ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }],
      };
  }
}

/** The single "needs you" predicate, shared by the list, the counts, the badge and the digest. */
export function needsWhere(now: Date): Prisma.LeadWhereInput {
  return { OR: FOLLOW_UP_PRIORITY.map((r) => reasonWhere(r, now)) };
}
